import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CheckState, PullRequest, ReviewDecision } from "./models.js";

const execFileAsync = promisify(execFile);
const PAGE_SIZE = 100;

// DEVflow is an interactive local tool, so prefer the account configured by
// `gh auth login` over a possibly restricted token injected by the shell.
export const ghEnvironment = (() => {
  const { GITHUB_TOKEN: _githubToken, GH_TOKEN: _ghToken, ...environment } = process.env;
  return environment;
})();

interface Options {
  includeAuthor: boolean;
  includeAssignee: boolean;
  includeReviewer: boolean;
  repository?: string;
  organization?: string;
}

interface GraphqlResponse {
  data?: {
    viewer: { login: string };
    search: {
      nodes: unknown[];
    };
  };
  errors?: Array<{ message: string }>;
}

const query = `
query PullRequests($search: String!) {
  viewer { login }
  search(query: $search, type: ISSUE, first: ${PAGE_SIZE}) {
    nodes {
      ... on PullRequest {
        number title url createdAt updatedAt isDraft mergeable reviewDecision
        author { login }
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        headRefName
        assignees(first: 20) { nodes { login } }
        latestReviews(first: 10) { nodes { author { login } state submittedAt } }
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              ... on CheckRun {
                name status conclusion detailsUrl databaseId
                checkSuite { workflowRun { databaseId } }
              }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
}`;

export async function fetchPullRequests(options: Options): Promise<{ login: string; pullRequests: PullRequest[] }> {
  await ensureAuthenticated();
  const login = await getViewerLogin();
  const searches: Array<{ role: "author" | "assignee" | "reviewer"; value: string }> = [];

  if (options.includeAuthor) searches.push({ role: "author", value: `author:${login}` });
  if (options.includeAssignee) searches.push({ role: "assignee", value: `assignee:${login}` });
  if (options.includeReviewer) searches.push({ role: "reviewer", value: `review-requested:${login}` });

  const results = await Promise.all(searches.map(({ role, value }) => search(value, role, options)));
  return {
    login,
    pullRequests: mergePullRequests(results.flat()),
  };
}

export function mergePullRequests(results: PullRequest[]): PullRequest[] {
  const pullRequests = new Map<string, PullRequest>();
  for (const result of results) {
    const key = `${result.repository}#${result.number}`;
    const existing = pullRequests.get(key);
    if (existing) {
      existing.roles = [...new Set([...existing.roles, ...result.roles])];
    } else {
      pullRequests.set(key, result);
    }
  }
  return [...pullRequests.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

interface Workflow {
  id: number;
  name: string;
  state: string;
}

export interface StagingDeployPreview {
  workflowId: number;
  workflowName: string;
  sha: string;
  message: string;
  lastRun: { status: string; conclusion: string | null; url: string } | null;
}

export async function previewStagingDeploy(repository: string): Promise<StagingDeployPreview> {
  const workflow = await stagingWorkflow(repository);
  const [{ stdout: commitOutput }, { stdout: runOutput }] = await Promise.all([
    execFileAsync("gh", ["api", `repos/${repository}/commits/staging`], { env: ghEnvironment }),
    execFileAsync("gh", ["run", "list", "--repo", repository, "--workflow", String(workflow.id), "--branch", "staging", "--limit", "1", "--json", "status,conclusion,url"], { env: ghEnvironment }),
  ]);
  const commit = JSON.parse(commitOutput) as { sha: string; commit: { message: string } };
  const runs = JSON.parse(runOutput) as Array<{ status: string; conclusion: string | null; url: string }>;
  return { workflowId: workflow.id, workflowName: workflow.name, sha: commit.sha, message: commit.commit.message.split("\n")[0], lastRun: runs[0] ?? null };
}

export async function triggerStagingDeploy(repository: string, workflowId?: number): Promise<void> {
  const workflow = workflowId ? { id: workflowId } : await stagingWorkflow(repository);
  await execFileAsync(
    "gh",
    ["workflow", "run", String(workflow.id), "--repo", repository, "--ref", "staging", "-f", "ENVIRONMENT=staging"],
    { env: ghEnvironment },
  );
}

async function stagingWorkflow(repository: string): Promise<Workflow> {
  const { stdout } = await execFileAsync(
    "gh",
    ["workflow", "list", "--repo", repository, "--json", "id,name,state"],
    { env: ghEnvironment },
  );
  const workflows = JSON.parse(stdout) as Workflow[];
  const candidates = workflows.filter((item) => item.state === "active" && item.name.includes("Build and Deploy Kubernetes Application"));
  const serviceName = repository.split("/").at(-1)?.toLowerCase();
  const workflow = candidates.find((item) => serviceName && item.name.toLowerCase().includes(serviceName))
    ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!workflow) {
    throw new Error(`No unambiguous active Kubernetes deployment workflow was found in ${repository}.`);
  }
  return workflow;
}

async function ensureAuthenticated(): Promise<void> {
  try {
    await execFileAsync("gh", ["auth", "status"], { env: ghEnvironment, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`GitHub CLI is not authenticated. Run \`gh auth login\` and try again. (${detail})`);
  }
}

async function getViewerLogin(): Promise<string> {
  const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"], { env: ghEnvironment });
  const login = stdout.trim();
  if (!login) throw new Error("Could not identify the authenticated GitHub account.");
  return login;
}

async function search(filter: string, role: "author" | "assignee" | "reviewer", options: Options): Promise<PullRequest[]> {
  const qualifiers = ["is:pr", "is:open", filter];
  if (options.repository) qualifiers.push(`repo:${options.repository}`);
  if (options.organization) qualifiers.push(`org:${options.organization}`);

  const { stdout } = await execFileAsync(
    "gh",
    ["api", "graphql", "-f", `query=${query}`, "-F", `search=${qualifiers.join(" ")}`],
    { env: ghEnvironment, maxBuffer: 10 * 1024 * 1024 },
  );
  const response = JSON.parse(stdout) as GraphqlResponse;
  if (response.errors?.length) throw new Error(response.errors.map((item) => item.message).join("; "));
  if (!response.data) throw new Error("GitHub returned an empty GraphQL response.");

  return response.data.search.nodes
    .filter(isPullRequestNode)
    .map((node) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      repository: node.repository.nameWithOwner,
      headRepository: node.headRepository?.nameWithOwner ?? null,
      headRefName: node.headRefName,
      author: node.author?.login ?? "ghost",
      assignees: node.assignees.nodes.map((assignee) => assignee.login),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      isDraft: node.isDraft,
      mergeable: node.mergeable,
      reviewDecision: node.reviewDecision,
      ...summarizeChecks(node.statusCheckRollup?.contexts.nodes ?? []),
      reviews: node.latestReviews.nodes.map((review) => ({
        author: review.author?.login ?? "ghost",
        state: review.state,
        submittedAt: review.submittedAt,
      })),
      roles: [role],
    }));
}

type CheckNode = {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string | null;
  targetUrl?: string | null;
  databaseId?: number | null;
  checkSuite?: { workflowRun?: { databaseId?: number | null } | null } | null;
};

export function summarizeChecks(checks: CheckNode[]): { checkState: CheckState; failingChecks: number; pendingChecks: number; checks: PullRequest["checks"] } {
  if (checks.length === 0) return { checkState: "none", failingChecks: 0, pendingChecks: 0, checks: [] };
  let failingChecks = 0;
  let pendingChecks = 0;
  for (const check of checks) {
    const conclusion = check.conclusion?.toUpperCase();
    const state = (check.state ?? check.status ?? "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(conclusion ?? state)) failingChecks++;
    else if (["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "EXPECTED"].includes(state)) pendingChecks++;
  }
  return {
    checkState: failingChecks > 0 ? "failing" : pendingChecks > 0 ? "pending" : "passing",
    failingChecks,
    pendingChecks,
    checks: checks.map((check) => ({
      name: check.name ?? check.context ?? "Unnamed check",
      state: check.state ?? check.status ?? "UNKNOWN",
      conclusion: check.conclusion ?? null,
      url: check.detailsUrl ?? check.targetUrl ?? null,
      workflowRunId: safeDatabaseId(check.checkSuite?.workflowRun?.databaseId),
      checkRunId: safeDatabaseId(check.databaseId),
    })),
  };
}

function safeDatabaseId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

interface PullRequestNode {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: ReviewDecision;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  headRepository: { nameWithOwner: string } | null;
  headRefName: string;
  assignees: { nodes: Array<{ login: string }> };
  latestReviews: { nodes: Array<{ author: { login: string } | null; state: string; submittedAt: string | null }> };
  statusCheckRollup: { contexts: { nodes: CheckNode[] } } | null;
}

function isPullRequestNode(value: unknown): value is PullRequestNode {
  return typeof value === "object" && value !== null && "number" in value && "repository" in value;
}
