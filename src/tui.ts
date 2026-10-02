import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import { ghEnvironment, previewStagingDeploy, triggerStagingDeploy, type StagingDeployPreview } from "./github.js";
import { analyzeFailedCheck, analyzeReview, commitWorktreeChanges, DirtyWorktreeError, discardWorktreeChanges, implementReview, listResumableWorktrees, pushWorktreeChanges, type ResumableWorktree, type ReviewAnalysis } from "./agent.js";
import type { ClassifiedPullRequest, Priority, PullRequestCheck } from "./models.js";
import { color } from "./colors.js";
import { renderTerminalMarkdown } from "./markdown.js";
import { helpMarkdown } from "./help.js";
import { createJiraIssue, jiraIssueTypes, jiraProjects, type JiraIssueType, type JiraProject } from "./jira.js";
import { countPriorities, formatRelativeTime, priorities, priorityTag } from "./render.js";

const execFileAsync = promisify(execFile);
const clear = "\x1b[2J\x1b[H";
const hideCursor = "\x1b[?25l";
const showCursor = "\x1b[?25h";

interface TuiOptions {
  login: string;
  pullRequests: ClassifiedPullRequest[];
  refresh: () => Promise<ClassifiedPullRequest[]>;
}

type DashboardTab = "work" | "reviews" | "worktrees" | "help";

export async function startTui(options: TuiOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive mode requires a terminal. Use `devflow list` instead.");

  let pullRequests = options.pullRequests;
  let selectedIndex = 0;
  let tab: DashboardTab = "work";
  let resumableWorktrees: ResumableWorktree[] = await listResumableWorktrees();
  let worktreeIndex = 0;
  let worktreeDetail = false;
  let helpOffset = 0;
  let filter: Priority | undefined;
  let detail = false;
  let loading = false;
  let message = "";
  let confirmingDeploy = false;
  let deployPreview: StagingDeployPreview | undefined;
  let confirmingImplementation = false;
  let confirmingDiscardWorktree = false;
  let dirtyWorktree: string | undefined;
  let analysis: ReviewAnalysis | undefined;
  let analysisKind: "review" | "ci" = "review";
  let analysisOutput = "";
  let analysisCost: number | undefined;
  let implementationReport = "";
  let worktree: string | undefined;
  let committed = false;
  let commitSha: string | undefined;
  let pushed = false;
  let confirmingCommit = false;
  let confirmingPush = false;
  let analysisOffset = 0;
  let ciChecks: PullRequestCheck[] | undefined;
  let ciCheckIndex = 0;
  let jiraProjectsList: JiraProject[] | undefined;
  let jiraTypes: JiraIssueType[] | undefined;
  let jiraProjectIndex = 0;
  let jiraTypeIndex = 0;
  let jiraProject: JiraProject | undefined;
  let confirmingJira = false;
  let spinnerFrame = 0;
  let spinnerTimer: NodeJS.Timeout | undefined;
  let activeRequest: AbortController | undefined;
  let finished = false;
  const input = process.stdin;
  let resolveExit: () => void;
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  process.stdout.write(hideCursor);

  const tabItems = () => tab === "work"
    ? pullRequests.filter((pullRequest) => pullRequest.roles.includes("author") || pullRequest.roles.includes("assignee"))
    : tab === "reviews"
      ? pullRequests.filter((pullRequest) => pullRequest.roles.includes("reviewer") && !pullRequest.roles.includes("author") && !pullRequest.roles.includes("assignee"))
      : [];
  const visible = () => filter ? tabItems().filter((pullRequest) => pullRequest.priority === filter) : tabItems();
  const selected = () => visible()[selectedIndex];

  const render = () => {
    const current = selected();
    const draw = (screen: string) => process.stdout.write(clear + color.screen(screen));
    if (selectedIndex >= visible().length) selectedIndex = Math.max(0, visible().length - 1);
    if (analysis && current) {
      draw(renderAnalysis(
        current,
        analysisOutput,
        analysisOffset,
        loading,
        { implementation: confirmingImplementation, discardWorktree: confirmingDiscardWorktree, commit: confirmingCommit, push: confirmingPush },
        worktree,
        { committed, commitSha, pushed },
        analysisCost,
        message,
        spinnerFrame,
        analysisKind,
      ));
      return;
    }
    if (tab === "worktrees") {
      draw(worktreeDetail && resumableWorktrees[worktreeIndex]
        ? renderWorktreeDetail(resumableWorktrees[worktreeIndex])
        : renderWorktrees(resumableWorktrees, worktreeIndex));
      return;
    }
    if (ciChecks && current) {
      draw(renderCiChecks(current, ciChecks, ciCheckIndex, message, loading, spinnerFrame));
      return;
    }
    if (jiraProjectsList && current) {
      draw(renderJira(current, jiraProjectsList, jiraTypes, jiraProjectIndex, jiraTypeIndex, jiraProject, message, loading));
      return;
    }
    if (tab === "help") {
      draw(renderHelp(helpOffset));
      return;
    }
    draw(detail && current
      ? renderDetail(current, message, confirmingDeploy, loading, spinnerFrame, Boolean(activeRequest), deployPreview)
      : renderDashboard(options.login, pullRequests, visible(), selectedIndex, tab, filter, loading, message, confirmingDeploy, spinnerFrame, Boolean(activeRequest), deployPreview));
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    input.removeListener("keypress", onKeypress);
    activeRequest?.abort();
    input.setRawMode(false);
    input.pause();
    if (spinnerTimer) clearInterval(spinnerTimer);
    process.stdout.write(showCursor + "\n");
    resolveExit();
  };

  const refresh = async () => {
    loading = true;
    message = "Refreshing GitHub data...";
    render();
    try {
      pullRequests = await options.refresh();
      resumableWorktrees = await listResumableWorktrees();
      selectedIndex = 0;
      worktreeIndex = 0;
      worktreeDetail = false;
      message = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not refresh pull requests.";
    } finally {
      loading = false;
      render();
    }
  };

  const open = async () => {
    const pullRequest = selected();
    if (!pullRequest) return;
    loading = true;
    message = `Opening #${pullRequest.number} in the browser...`;
    render();
    try {
      await execFileAsync("gh", ["pr", "view", String(pullRequest.number), "--repo", pullRequest.repository, "--web"], { env: ghEnvironment });
      message = `Opened #${pullRequest.number}.`;
    } catch {
      message = "Could not open the pull request in the browser.";
    } finally {
      loading = false;
      render();
    }
  };

  const deploy = async () => {
    const pullRequest = selected();
    if (!pullRequest) return;
    loading = true;
    confirmingDeploy = false;
    message = `Triggering staging deploy for ${pullRequest.repository}...`;
    render();
    try {
      await triggerStagingDeploy(pullRequest.repository, deployPreview?.workflowId);
      message = `Staging deploy triggered for ${pullRequest.repository} at ${deployPreview?.sha.slice(0, 7) ?? "staging"}.`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not trigger the staging deploy.";
    } finally {
      loading = false;
      deployPreview = undefined;
      render();
    }
  };

  const prepareDeploy = async () => {
    const pullRequest = selected();
    if (!pullRequest) return;
    loading = true;
    message = `Loading staging deployment preview for ${pullRequest.repository}...`;
    render();
    try {
      deployPreview = await previewStagingDeploy(pullRequest.repository);
      confirmingDeploy = true;
      message = "";
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not load the staging deployment preview.";
    } finally {
      loading = false;
      render();
    }
  };

  const runAnalysis = async () => {
    const pullRequest = selected();
    if (!pullRequest) return;
    loading = true;
    const request = new AbortController();
    activeRequest = request;
    message = `Collecting review context for #${pullRequest.number}...`;
    analysisCost = undefined;
    render();
    try {
      analysisKind = "review";
      analysis = await analyzeReview(pullRequest, (progress) => {
        message = progress;
        render();
      }, request.signal);
      analysisOutput = analysis.result;
      analysisCost = analysis.cost;
      analysisOffset = 0;
      message = "";
    } catch (error) {
      message = request.signal.aborted ? "Review analysis cancelled." : error instanceof Error ? error.message : "Could not analyze review feedback.";
    } finally {
      if (activeRequest === request) activeRequest = undefined;
      loading = false;
      render();
    }
  };

  const runFailedCheckDiagnosis = async () => {
    const pullRequest = selected();
    const check = ciChecks?.[ciCheckIndex];
    if (!pullRequest || !check) return;
    loading = true;
    const request = new AbortController();
    activeRequest = request;
    message = `Collecting failed CI context for ${check.name}...`;
    analysisCost = undefined;
    render();
    try {
      analysisKind = "ci";
      analysis = await analyzeFailedCheck(pullRequest, check, (progress) => {
        message = progress;
        render();
      }, request.signal);
      analysisOutput = analysis.result;
      analysisCost = analysis.cost;
      analysisOffset = 0;
      ciChecks = undefined;
      message = "";
    } catch (error) {
      message = request.signal.aborted ? "CI diagnosis cancelled." : error instanceof Error ? error.message : "Could not diagnose the failed check.";
    } finally {
      if (activeRequest === request) activeRequest = undefined;
      loading = false;
      render();
    }
  };

  const openFailedCheck = async () => {
    const pullRequest = selected();
    const check = ciChecks?.[ciCheckIndex];
    if (!pullRequest || !check?.workflowRunId) return;
    loading = true;
    message = `Opening workflow run for ${check.name}...`;
    render();
    try {
      await execFileAsync("gh", ["run", "view", String(check.workflowRunId), "--repo", pullRequest.repository, "--web"], { env: ghEnvironment });
      message = `Opened workflow run for ${check.name}.`;
    } catch {
      message = "Could not open the GitHub Actions workflow run in the browser.";
    } finally {
      loading = false;
      render();
    }
  };

  const startJira = async () => {
    loading = true; message = "Loading Jira projects..."; render();
    try {
      jiraProjectsList = await jiraProjects();
      jiraProjectIndex = 0;
      message = jiraProjectsList.length ? "" : "No Jira projects are visible to this account. Check Browse Projects permission.";
    }
    catch (error) { message = error instanceof Error ? error.message : "Could not load Jira projects."; }
    finally { loading = false; render(); }
  };
  const loadJiraTypes = async () => {
    const project = jiraProjectsList?.[jiraProjectIndex]; if (!project) return;
    loading = true; message = `Loading issue types for ${project.key}...`; render();
    try { jiraProject = project; jiraTypes = await jiraIssueTypes(project.key); jiraTypeIndex = 0; message = ""; }
    catch (error) { message = error instanceof Error ? error.message : "Could not load Jira issue types."; }
    finally { loading = false; render(); }
  };
  const createJira = async () => {
    const pullRequest = selected(); const type = jiraTypes?.[jiraTypeIndex]; if (!pullRequest || !jiraProject || !type) return;
    confirmingJira = false; loading = true; message = "Creating Jira card..."; render();
    try { const issue = await createJiraIssue(pullRequest, jiraProject, type); message = `Created ${issue.key}: ${issue.url}`; jiraProjectsList = undefined; jiraTypes = undefined; jiraProject = undefined; }
    catch (error) { message = error instanceof Error ? error.message : "Could not create Jira card."; }
    finally { loading = false; render(); }
  };

  const implement = async () => {
    const pullRequest = selected();
    if (!pullRequest || !analysis) return;
    loading = true;
    const request = new AbortController();
    activeRequest = request;
    confirmingImplementation = false;
    committed = false;
    commitSha = undefined;
    pushed = false;
    analysisCost = undefined;
    message = `Creating isolated worktree for #${pullRequest.number}...`;
    render();
    try {
      const result = await implementReview(pullRequest, analysis, (progress) => {
        message = progress;
        render();
      }, request.signal);
      worktree = result.worktree;
      analysisOutput = result.result;
      implementationReport = result.result;
      analysisCost = result.cost;
      analysisOffset = 0;
      message = "Implementation complete. Review the worktree before committing.";
    } catch (error) {
      if (error instanceof DirtyWorktreeError) {
        dirtyWorktree = error.worktree;
        confirmingDiscardWorktree = true;
        message = "";
      } else {
        message = request.signal.aborted ? "Implementation cancelled." : error instanceof Error ? error.message : "Could not implement review feedback.";
      }
    } finally {
      if (activeRequest === request) activeRequest = undefined;
      loading = false;
      render();
    }
  };

  const discardAndRetryImplementation = async () => {
    const path = dirtyWorktree;
    if (!path) return;
    confirmingDiscardWorktree = false;
    loading = true;
    message = "Discarding uncommitted changes from the previous attempt...";
    render();
    try {
      await discardWorktreeChanges(path);
      dirtyWorktree = undefined;
      loading = false;
      void implement();
    } catch (error) {
      loading = false;
      message = error instanceof Error ? error.message : "Could not discard the uncommitted changes.";
      render();
    }
  };

  const inspectWorktree = async () => {
    if (!worktree) return;
    loading = true;
    const request = new AbortController();
    activeRequest = request;
    message = "Inspecting worktree changes...";
    render();
    try {
      const options = { signal: request.signal, maxBuffer: 10 * 1024 * 1024 };
      const [status, stat, whitespace] = await Promise.all([
        execFileAsync("git", ["-C", worktree, "status", "--short"], options),
        execFileAsync("git", ["-C", worktree, "diff", "--stat"], options),
        execFileAsync("git", ["-C", worktree, "diff", "--check"], options)
          .then(({ stdout }) => stdout)
          .catch((error: unknown) => commandOutput(error)),
      ]);
      analysisOutput = `# Status do worktree\n\n## Arquivos alterados\n\n\`\`\`text\n${status.stdout.trim() || "Nenhuma alteracao local."}\n\`\`\`\n\n## Resumo do diff\n\n\`\`\`text\n${stat.stdout.trim() || "Nenhum diff local."}\n\`\`\`\n\n## Validacao de whitespace\n\n\`\`\`text\n${whitespace.trim() || "Sem problemas encontrados."}\n\`\`\``;
      analysisOffset = 0;
      message = "Worktree inspected.";
    } catch (error) {
      message = request.signal.aborted ? "Worktree inspection cancelled." : error instanceof Error ? error.message : "Could not inspect the worktree.";
    } finally {
      if (activeRequest === request) activeRequest = undefined;
      loading = false;
      render();
    }
  };

  const commitChanges = async () => {
    const pullRequest = selected();
    if (!pullRequest || !worktree) return;
    confirmingCommit = false;
    loading = true;
    message = "Committing changes in the worktree...";
    render();
    try {
      const result = await commitWorktreeChanges(worktree, commitMessage(pullRequest));
      committed = true;
      commitSha = result.sha;
      message = `Committed ${result.sha.slice(0, 7)}. Press p to push to ${pullRequest.headRefName}.`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not commit the worktree changes.";
    } finally {
      loading = false;
      render();
    }
  };

  const pushChanges = async () => {
    const pullRequest = selected();
    if (!pullRequest || !worktree || !committed) return;
    confirmingPush = false;
    loading = true;
    message = `Pushing to ${pullRequest.headRepository ?? pullRequest.repository}:${pullRequest.headRefName}...`;
    render();
    try {
      await pushWorktreeChanges(pullRequest, worktree);
      pushed = true;
      message = `Pushed to ${pullRequest.headRefName}. The pull request will update shortly.`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not push the committed changes.";
    } finally {
      loading = false;
      render();
    }
  };

  const onKeypress = (_character: string, key: readline.Key) => {
    if (key.name === "right") key = { ...key, name: "return" };
    if (key.name === "left") key = { ...key, name: "escape" };
    if (key.ctrl && key.name === "c") {
      finish();
      return;
    }
    if (key.name === "q") {
      finish();
      return;
    }
    if (key.name === "x" && loading && activeRequest) {
      message = "Cancelling current operation...";
      activeRequest.abort();
      render();
      return;
    }
    if (confirmingImplementation) {
      if (key.name === "y") void implement();
      else if (key.name === "n" || key.name === "escape") {
        confirmingImplementation = false;
        message = "Implementation cancelled.";
        render();
      }
      return;
    }
    if (confirmingDiscardWorktree) {
      if (key.name === "y") void discardAndRetryImplementation();
      else if (key.name === "n" || key.name === "escape") {
        confirmingDiscardWorktree = false;
        dirtyWorktree = undefined;
        message = "Implementation cancelled. The existing worktree was left untouched.";
        render();
      }
      return;
    }
    if (confirmingCommit) {
      if (key.name === "y") void commitChanges();
      else if (key.name === "n" || key.name === "escape") {
        confirmingCommit = false;
        message = "Commit cancelled.";
        render();
      }
      return;
    }
    if (confirmingPush) {
      if (key.name === "y") void pushChanges();
      else if (key.name === "n" || key.name === "escape") {
        confirmingPush = false;
        message = "Push cancelled.";
        render();
      }
      return;
    }
    if (confirmingDeploy) {
      if (key.name === "y") void deploy();
      else if (key.name === "n" || key.name === "escape") {
        confirmingDeploy = false;
        deployPreview = undefined;
        message = "Staging deploy cancelled.";
        render();
      }
      return;
    }
    if (analysis) {
      if (key.name === "escape") {
        analysis = undefined;
        analysisKind = "review";
        analysisOutput = "";
        analysisCost = undefined;
        worktree = undefined;
        committed = false;
        commitSha = undefined;
        pushed = false;
        message = "";
        render();
      } else if (key.name === "down" && !loading) {
        analysisOffset = Math.min(analysisOffset + 1, Math.max(0, analysisLineCount(analysisOutput) - contentRows(9)));
        render();
      } else if (key.name === "up" && !loading) {
        analysisOffset = Math.max(0, analysisOffset - 1);
        render();
      } else if (key.name === "i" && analysisKind === "review" && !loading && !worktree) {
        confirmingImplementation = true;
        message = "";
        render();
      } else if (key.name === "g" && !loading && worktree) {
        void inspectWorktree();
      } else if (key.name === "s" && worktree) {
        analysisOutput = implementationReport;
        analysisOffset = 0;
        message = "Implementation report restored.";
        render();
      } else if (key.name === "c" && !loading && worktree && !committed) {
        confirmingCommit = true;
        message = "";
        render();
      } else if (key.name === "p" && !loading && worktree && committed && !pushed) {
        confirmingPush = true;
        message = "";
        render();
      }
      return;
    }
    if (ciChecks) {
      if (key.name === "escape") {
        ciChecks = undefined;
        message = "";
      } else if (key.name === "down" && !loading) {
        ciCheckIndex = nextIndex(ciCheckIndex, ciChecks.length, 1);
      } else if (key.name === "up" && !loading) {
        ciCheckIndex = nextIndex(ciCheckIndex, ciChecks.length, -1);
      } else if (key.name === "return" && !loading) {
        void runFailedCheckDiagnosis();
      } else if (key.name === "o" && !loading) {
        void openFailedCheck();
      }
      render();
      return;
    }
    if (jiraProjectsList) {
      if (confirmingJira) {
        if (key.name === "y") void createJira();
        else if (key.name === "n" || key.name === "escape") { confirmingJira = false; message = "Jira card creation cancelled."; render(); }
        return;
      }
      if (key.name === "escape") { jiraProjectsList = undefined; jiraTypes = undefined; jiraProject = undefined; message = ""; }
      else if (!jiraTypes && key.name === "down") jiraProjectIndex = nextIndex(jiraProjectIndex, jiraProjectsList.length, 1);
      else if (!jiraTypes && key.name === "up") jiraProjectIndex = nextIndex(jiraProjectIndex, jiraProjectsList.length, -1);
      else if (jiraTypes && key.name === "down") jiraTypeIndex = nextIndex(jiraTypeIndex, jiraTypes.length, 1);
      else if (jiraTypes && key.name === "up") jiraTypeIndex = nextIndex(jiraTypeIndex, jiraTypes.length, -1);
      else if (key.name === "return" && !loading) { if (!jiraTypes) void loadJiraTypes(); else { confirmingJira = true; message = "Create this Jira card? [y] Create  [n] Cancel"; } }
      render(); return;
    }
    if (key.name === "escape" && detail) {
      detail = false;
      message = "";
      render();
      return;
    }
    if (key.name === "return") {
      if (selected()) detail = !detail;
      render();
      return;
    }
    if (key.name === "j" && !loading && detail && selected()) { void startJira(); return; }
    if (key.name === "tab") {
      tab = tab === "work" ? "reviews" : tab === "reviews" ? "worktrees" : tab === "worktrees" ? "help" : "work";
      selectedIndex = 0;
      worktreeIndex = 0;
      detail = false;
      helpOffset = 0;
      message = "";
      render();
      return;
    }
    if (tab === "help") {
      if (key.name === "down") helpOffset = Math.min(helpOffset + 1, Math.max(0, helpLineCount() - contentRows(7)));
      else if (key.name === "up") helpOffset = Math.max(0, helpOffset - 1);
      render();
      return;
    }
    if (tab === "worktrees") {
      if (key.name === "escape" && worktreeDetail) worktreeDetail = false;
      else if (key.name === "return" && resumableWorktrees[worktreeIndex]) worktreeDetail = !worktreeDetail;
      else if (key.name === "down") worktreeIndex = nextIndex(worktreeIndex, resumableWorktrees.length, 1);
      else if (key.name === "up") worktreeIndex = nextIndex(worktreeIndex, resumableWorktrees.length, -1);
      else if (key.name === "r" && !loading) void refresh();
      render();
      return;
    }
    if (key.name === "down") {
      selectedIndex = nextIndex(selectedIndex, visible().length, 1);
      render();
      return;
    }
    if (key.name === "up") {
      selectedIndex = nextIndex(selectedIndex, visible().length, -1);
      render();
      return;
    }
    if (key.name === "r" && !loading) void refresh();
    else if (key.name === "o") void open();
    else if (key.name === "a" && !loading && selected()) void runAnalysis();
    else if (key.name === "c" && !loading && detail && selected()) {
      const checks = actionableFailedChecks(selected());
      if (checks.length) {
        ciChecks = checks;
        ciCheckIndex = 0;
        message = "";
      } else {
        message = "No inspectable failed GitHub Actions checks with safe identifiers.";
        render();
      }
    }
    else if (key.name === "d" && !loading && selected()) void prepareDeploy();
    else if (key.name === "0") { filter = undefined; selectedIndex = 0; render(); }
    else if (["1", "2", "3", "4"].includes(key.name ?? "")) {
      filter = priorities[Number(key.name) - 1].key;
      selectedIndex = 0;
      detail = false;
      render();
    }
  };

  input.on("keypress", onKeypress);
  spinnerTimer = setInterval(() => {
    if (!loading || finished) return;
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
    render();
  }, 120);
  render();
  await exited;
}

function renderDashboard(login: string, all: ClassifiedPullRequest[], visible: ClassifiedPullRequest[], selectedIndex: number, tab: DashboardTab, filter: Priority | undefined, loading: boolean, message: string, confirmingDeploy = false, spinnerFrame = 0, canCancel = false, deployPreview?: StagingDeployPreview): string {
  const workCount = all.filter((pullRequest) => pullRequest.roles.includes("author") || pullRequest.roles.includes("assignee")).length;
  const reviewCount = all.filter((pullRequest) => pullRequest.roles.includes("reviewer") && !pullRequest.roles.includes("author") && !pullRequest.roles.includes("assignee")).length;
  const counts = countPriorities(visible);
  const lines = [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan(`@${login}`)}${loading ? color.yellow(" // REFRESHING") : ""}`),
    color.panel(""),
    color.panel(` ${color.bold(tab === "work" ? color.cyan(`[ MY WORK ${workCount} ]`) : color.muted(`  MY WORK ${workCount}  `))} ${color.bold(tab === "reviews" ? color.cyan(`[ REVIEWS ${reviewCount} ]`) : color.muted(`  REVIEWS ${reviewCount}  `))} ${color.bold(color.muted("  HELP  "))}`),
    color.panel(` ${visible.length} SHOWN     ${color.green(`READY ${counts.ready}`)}   ${color.yellow(`ACTION ${counts.action}`)}   ${color.blue(`WAITING ${counts.waiting}`)}   ${color.red(`BLOCKED ${counts.blocked}`)}`),
    color.panel(` ${color.muted("FILTER:")} ${filter ? priorityTag(filter) : color.cyan("[ALL]")}    ${color.muted("[Tab] SWITCH  [1-4] PRIORITY  [0] ALL")}`),
    "",
  ];

  if (visible.length === 0) lines.push(color.muted(" No pull requests in this section."));
  const pageSize = Math.max(1, Math.floor(contentRows(8) / 2));
  const { start, end } = viewport(visible.length, selectedIndex, pageSize);
  for (const [offset, pullRequest] of visible.slice(start, end).entries()) {
    const index = start + offset;
    const marker = index === selectedIndex ? ">" : " ";
    const row = `${marker} ${priorityTag(pullRequest.priority)} #${pullRequest.number}  ${truncate(pullRequest.title, titleWidth())}`;
    lines.push(index === selectedIndex ? color.selected(row) : row);
    lines.push(`     ${color.muted(`${pullRequest.repository} · ${roleLabel(pullRequest)} · ${pullRequest.reason} · ${formatRelativeTime(pullRequest.updatedAt)}`)}`);
  }
  if (visible.length > pageSize) lines.push(color.muted(` [${start + 1}-${end} of ${visible.length}]`));
  lines.push("", color.footer(color.muted(loading && canCancel ? " [x] CANCEL  [q] QUIT" : " [Tab] SWITCH  [Enter] DETAILS  [a] REVIEW AI  [o] OPEN BROWSER  [d] DEPLOY STAGING  [r] REFRESH  [q] QUIT")));
  if (confirmingDeploy) lines.push(...renderDeployConfirmation(deployPreview));
  if (message) lines.push(` ${renderStatus(message, loading, spinnerFrame)}`);
  return lines.join("\n");
}

function renderDetail(pullRequest: ClassifiedPullRequest, message: string, confirmingDeploy = false, loading = false, spinnerFrame = 0, canCancel = false, deployPreview?: StagingDeployPreview): string {
  const review = pullRequest.reviewDecision?.replaceAll("_", " ").toLowerCase() ?? "no review decision";
  const actionableChecks = pullRequest.checks.filter((check) => isActionableCheck(check.state, check.conclusion)).slice(0, 3);
  const recentReviews = pullRequest.reviews.filter((item) => item.state !== "PENDING").slice(0, 3);
  return [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan(`#${pullRequest.number}`)} ${color.muted("//")} ${color.muted(pullRequest.repository)}`),
    "",
    ` ${color.bold(pullRequest.title)}`,
    "",
    ` ${color.muted("PRIORITY:")} ${priorityTag(pullRequest.priority)} ${color.muted(`(${pullRequest.reason})`)}`,
    ` ${color.muted("ROLE:")} ${roleLabel(pullRequest)}`,
    ` ${color.muted("AUTHOR:")} ${color.cyan(`@${pullRequest.author}`)}`,
    ` ${color.muted("ASSIGNEES:")} ${pullRequest.assignees.length ? pullRequest.assignees.map((assignee) => color.cyan(`@${assignee}`)).join(", ") : "none"}`,
    ` ${color.muted("REVIEW:")} ${review}`,
    ` ${color.muted("CHECKS:")} ${pullRequest.checkState}${pullRequest.failingChecks ? color.red(` (${pullRequest.failingChecks} failing)`) : ""}${pullRequest.pendingChecks ? color.yellow(` (${pullRequest.pendingChecks} running)`) : ""}`,
    ` ${color.muted("MERGEABILITY:")} ${pullRequest.mergeable.toLowerCase()}`,
    ` ${color.muted("UPDATED:")} ${new Date(pullRequest.updatedAt).toLocaleString()}`,
    ...(recentReviews.length ? ["", color.muted("RECENT REVIEWS:"), ...recentReviews.map((item) => `  ${reviewState(item.state)} ${color.cyan(`@${item.author}`)} ${color.muted(item.submittedAt ? formatRelativeTime(item.submittedAt) : "")}`)] : []),
    ...(actionableChecks.length ? ["", color.muted("ATTENTION CHECKS:"), ...actionableChecks.map((check) => `  ${checkStateLabel(check.state, check.conclusion)} ${truncate(check.name, titleWidth())}${check.url ? color.muted(`  ${check.url}`) : ""}`)] : []),
    "",
    ` ${pullRequest.url}`,
    "",
    color.footer(color.muted(loading && canCancel ? " [x] CANCEL  [q] QUIT" : ` [Esc] BACK  [a] REVIEW AI  [j] JIRA${actionableFailedChecks(pullRequest).length ? "  [c] INSPECT FAILED CI" : ""}  [o] OPEN BROWSER  [d] DEPLOY STAGING  [r] REFRESH  [q] QUIT`)),
    ...(confirmingDeploy ? renderDeployConfirmation(deployPreview) : []),
    ...(message ? [` ${renderStatus(message, loading, spinnerFrame)}`] : []),
  ].join("\n");
}

interface AnalysisConfirmations {
  implementation: boolean;
  discardWorktree: boolean;
  commit: boolean;
  push: boolean;
}

interface WorktreeGitState {
  committed: boolean;
  commitSha?: string;
  pushed: boolean;
}

function renderAnalysis(pullRequest: ClassifiedPullRequest, output: string, offset: number, loading: boolean, confirmations: AnalysisConfirmations, worktree: string | undefined, gitState: WorktreeGitState, cost: number | undefined, message: string, spinnerFrame: number, kind: "review" | "ci"): string {
  const costSuffix = !loading && typeof cost === "number" ? color.muted(` · ~$${cost.toFixed(4)}`) : "";
  const lines = [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan(kind === "ci" ? "CI DIAGNOSIS" : "REVIEW AI")} ${color.muted("//")} ${color.muted(`${pullRequest.repository}#${pullRequest.number}`)}`),
    "",
    `${color.bold(loading ? renderStatus(message || "Working...", true, spinnerFrame) : worktree ? color.green(" IMPLEMENTATION COMPLETE") : color.cyan(kind === "ci" ? " READ-ONLY CI TRIAGE" : " REVIEW TRIAGE"))}${costSuffix}`,
    "",
  ];
  const outputLines = renderTerminalMarkdown(output).split("\n");
  const pageSize = contentRows(9);
  const safeOffset = Math.min(offset, Math.max(0, outputLines.length - pageSize));
  const visible = outputLines.slice(safeOffset, safeOffset + pageSize);
  lines.push(...visible.map((line) => ` ${line}`));
  if (outputLines.length > pageSize) lines.push(color.muted(` [${safeOffset + 1}-${Math.min(safeOffset + pageSize, outputLines.length)} of ${outputLines.length}]`));
  if (worktree) {
    lines.push("", `${color.muted("WORKTREE:")} ${color.cyan(worktree)}`);
    const gitStatus = gitState.pushed
      ? `${color.green("pushed")} ${gitState.commitSha?.slice(0, 7) ?? ""}`
      : gitState.committed
        ? `${color.green("committed")} ${gitState.commitSha?.slice(0, 7) ?? ""} (not pushed)`
        : color.yellow("not committed");
    lines.push(`${color.muted("GIT:")} ${gitStatus}`);
  }
  lines.push("");
  if (!worktree) {
    lines.push(color.footer(color.muted(loading ? " [x] CANCEL  [q] QUIT" : kind === "ci" ? " [Esc] BACK  [Arrows] SCROLL  [q] QUIT" : " [i] IMPLEMENT REQUIRED CHANGES  [Esc] BACK  [Arrows] SCROLL  [q] QUIT")));
  } else {
    const gitAction = gitState.pushed ? "" : gitState.committed ? "  [p] PUSH TO PR BRANCH" : "  [c] COMMIT CHANGES";
    lines.push(color.footer(color.muted(` [g] WORKTREE STATUS  [s] SUMMARY${gitAction}  [Esc] BACK  [Arrows] SCROLL  [q] QUIT`)));
  }
  if (confirmations.implementation) lines.push(color.footer(color.bold(color.yellow(" CREATE ISOLATED WORKTREE AND IMPLEMENT? [y] CONTINUE  [n] CANCEL"))));
  if (confirmations.discardWorktree) lines.push(color.footer(color.bold(color.yellow(" PREVIOUS ATTEMPT LEFT UNCOMMITTED CHANGES. DISCARD AND RETRY? [y] DISCARD  [n] CANCEL"))));
  if (confirmations.commit) lines.push(color.footer(color.bold(color.yellow(" COMMIT ALL CHANGES IN THE WORKTREE? [y] COMMIT  [n] CANCEL"))));
  if (confirmations.push) lines.push(color.footer(color.bold(color.yellow(` PUSH TO ${pullRequest.headRepository ?? pullRequest.repository}:${pullRequest.headRefName}? THIS UPDATES THE OPEN PULL REQUEST. [y] PUSH  [n] CANCEL`))));
  if (message && !loading) lines.push(` ${renderStatus(message, false, spinnerFrame)}`);
  return lines.join("\n");
}

function renderCiChecks(pullRequest: ClassifiedPullRequest, checks: PullRequestCheck[], selectedIndex: number, message: string, loading: boolean, spinnerFrame: number): string {
  const lines = [
    ` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan("FAILED CI")} ${color.muted("//")} ${color.muted(`${pullRequest.repository}#${pullRequest.number}`)}`,
    "",
    color.bold(" Select a failed GitHub Actions check"),
    color.muted(" Only checks with safe workflow and check-run identifiers are shown."),
    "",
    ...checks.map((check, index) => {
      const row = `${index === selectedIndex ? ">" : " "} ${checkStateLabel(check.state, check.conclusion)} ${truncate(check.name, titleWidth())}`;
      const ids = `     run ${check.workflowRunId} · check ${check.checkRunId}`;
      return index === selectedIndex ? `${color.selected(row)}\n${color.muted(ids)}` : `${row}\n${color.muted(ids)}`;
    }),
    "",
    color.footer(color.muted(loading ? " [x] CANCEL  [q] QUIT" : " [Enter] DIAGNOSE READ-ONLY  [o] OPEN WORKFLOW RUN  [Esc] BACK  [Arrows] SELECT  [q] QUIT")),
    ...(message ? [` ${renderStatus(message, loading, spinnerFrame)}`] : []),
  ];
  return lines.join("\n");
}

function renderHelp(offset: number): string {
  const lines = renderTerminalMarkdown(helpMarkdown).split("\n");
  const pageSize = contentRows(7);
  const safeOffset = Math.min(offset, Math.max(0, lines.length - pageSize));
  return [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan("HELP")}`),
    "",
    ...lines.slice(safeOffset, safeOffset + pageSize).map((line) => ` ${line}`),
    ...(lines.length > pageSize ? [color.muted(` [${safeOffset + 1}-${Math.min(safeOffset + pageSize, lines.length)} of ${lines.length}]`)] : []),
    "",
    color.footer(color.muted(" [Tab] SWITCH  [Arrows] SCROLL  [q] QUIT")),
  ].join("\n");
}

function renderJira(pullRequest: ClassifiedPullRequest, projects: JiraProject[], types: JiraIssueType[] | undefined, projectIndex: number, typeIndex: number, project: JiraProject | undefined, message: string, loading: boolean): string {
  const selectingTypes = Boolean(types);
  const items = selectingTypes ? types ?? [] : projects;
  const selected = selectingTypes ? typeIndex : projectIndex;
  return [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan("CREATE JIRA CARD")}`),
    "",
    ` ${pullRequest.title}`,
    color.muted(` ${pullRequest.repository}#${pullRequest.number}`),
    "",
    color.bold(selectingTypes ? ` Select issue type for ${project?.key}` : " Select Jira project"),
    "",
    ...items.slice(0, contentRows(10)).map((item, index) => `${index === selected ? ">" : " "} ${"key" in item ? `${item.key}  ${item.name}` : item.name}`),
    "",
    color.footer(color.muted(loading ? " [x] CANCEL  [q] QUIT" : " [Enter] SELECT  [Esc] CANCEL  [Arrows] MOVE  [q] QUIT")),
    ...(message ? [color.muted(` ${message}`)] : []),
  ].join("\n");
}

function renderWorktrees(worktrees: ResumableWorktree[], selectedIndex: number): string {
  const pageSize = Math.max(1, Math.floor(contentRows(7) / 3));
  const { start, end } = viewport(worktrees.length, selectedIndex, pageSize);
  const lines = [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan("WORKTREES")}`),
    "",
    color.muted(" Worktrees criados pelo DEVflow que podem ser retomados."),
    "",
  ];
  if (worktrees.length === 0) lines.push(color.muted(" Nenhum worktree persistente encontrado."));
  for (const [offset, worktree] of worktrees.slice(start, end).entries()) {
    const index = start + offset;
    const row = `${index === selectedIndex ? ">" : " "} #${worktree.number}  ${truncate(worktree.title, titleWidth())}`;
    lines.push(index === selectedIndex ? color.selected(row) : row);
    lines.push(`     ${worktree.repository} · ${worktree.dirty ? color.yellow("local changes") : color.green("clean")} · ${formatRelativeTime(worktree.updatedAt)}`);
    lines.push(`     ${color.muted(`${worktree.state} · ${worktree.headRef} @ ${worktree.headSha.slice(0, 7)}`)}`);
    lines.push(`     ${color.muted(worktree.worktree)}`);
  }
  if (worktrees.length > pageSize) lines.push(color.muted(` [${start + 1}-${end} of ${worktrees.length}]`));
  lines.push("", color.footer(color.muted(" [Tab] SWITCH  [Arrows] SELECT  [Enter] DETAILS  [r] REFRESH  [q] QUIT")));
  return lines.join("\n");
}

function renderWorktreeDetail(worktree: ResumableWorktree): string {
  return [
    color.panel(` ${color.bold(color.magenta("DEVflow"))} ${color.cyan("//")} ${color.cyan("WORKTREE DETAIL")}`),
    "",
    ` ${color.bold(`#${worktree.number}  ${worktree.title}`)}`,
    "",
    ` ${color.muted("REPOSITORY:")} ${worktree.repository}`,
    ` ${color.muted("STATE:")} ${worktree.state}`,
    ` ${color.muted("LOCAL:")} ${worktree.dirty ? color.yellow("local changes") : color.green("clean")}`,
    ` ${color.muted("HEAD REF:")} ${worktree.headRef}`,
    ` ${color.muted("HEAD SHA:")} ${worktree.headSha}`,
    ` ${color.muted("UPDATED:")} ${new Date(worktree.updatedAt).toLocaleString()}`,
    ` ${color.muted("REPORT:")} ${worktree.reportPath ? color.cyan(worktree.reportPath) : color.muted("none yet")}`,
    "",
    color.muted(worktree.worktree),
    "",
    color.footer(color.muted(" [Esc] BACK  [r] REFRESH  [q] QUIT")),
  ].join("\n");
}

const spinnerFrames = ["|", "/", "-", "\\"];

function renderStatus(message: string, loading: boolean, spinnerFrame: number): string {
  return loading ? `${color.magenta(`[${spinnerFrames[spinnerFrame]}]`)} ${color.yellow(message)}` : color.yellow(message);
}


function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function contentRows(reservedRows: number): number {
  return Math.max(4, (process.stdout.rows || 24) - reservedRows);
}

function viewport(total: number, selectedIndex: number, pageSize: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(pageSize / 2), total - pageSize));
  return { start, end: Math.min(total, start + pageSize) };
}

function titleWidth(): number {
  return Math.max(28, (process.stdout.columns || 100) - 34);
}

function roleLabel(pullRequest: ClassifiedPullRequest): string {
  const roles = pullRequest.roles;
  if (roles.includes("author") && roles.includes("assignee")) return "you authored + assigned";
  if (roles.includes("author")) return "you authored";
  if (roles.includes("reviewer")) return "review requested from you";
  return "assigned to you";
}

function reviewState(state: string): string {
  const label = state.replaceAll("_", " ").toLowerCase();
  if (state === "APPROVED") return color.green(label);
  if (state === "CHANGES_REQUESTED") return color.red(label);
  return color.yellow(label);
}

function isActionableCheck(state: string, conclusion: string | null): boolean {
  const value = (conclusion ?? state).toUpperCase();
  return !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(value);
}

function actionableFailedChecks(pullRequest: ClassifiedPullRequest): PullRequestCheck[] {
  return pullRequest.checks.filter((check) => isFailedCheck(check.state, check.conclusion) && isSafeActionId(check.workflowRunId) && isSafeActionId(check.checkRunId));
}

function isFailedCheck(state: string, conclusion: string | null): boolean {
  const value = (conclusion ?? state).toUpperCase();
  return ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(value);
}

function isSafeActionId(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function checkStateLabel(state: string, conclusion: string | null): string {
  const value = (conclusion ?? state).replaceAll("_", " ").toLowerCase();
  if (["failure", "error", "timed out", "cancelled", "action required"].includes(value)) return color.red(value);
  return color.yellow(value);
}

function analysisLineCount(output: string): number {
  return renderTerminalMarkdown(output).split("\n").length;
}

function helpLineCount(): number {
  return renderTerminalMarkdown(helpMarkdown).split("\n").length;
}

function commandOutput(error: unknown): string {
  if (typeof error !== "object" || error === null) return "Falha ao executar validacao.";
  const output = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  const details = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return `${output}\n${details}`.trim() || "Falha ao executar validacao.";
}

function nextIndex(current: number, total: number, delta: 1 | -1): number {
  if (total === 0) return 0;
  return (current + delta + total) % total;
}

function commitMessage(pullRequest: ClassifiedPullRequest): string {
  return `Apply review feedback via DEVflow\n\nAutomated change generated by OpenCode from the review triage for #${pullRequest.number}. Verify behavior before merging.`;
}

function renderDeployConfirmation(preview: StagingDeployPreview | undefined): string[] {
  if (!preview) return [color.footer(color.bold(color.yellow(" DEPLOY FROM BRANCH staging? [y] TRIGGER  [n] CANCEL")))];
  const lastRun = preview.lastRun ? `last run: ${preview.lastRun.status}/${preview.lastRun.conclusion ?? "pending"}` : "no previous run";
  return [
    color.footer(color.bold(color.yellow(` DEPLOY staging @ ${preview.sha.slice(0, 7)}? [y] TRIGGER  [n] CANCEL`))),
    color.footer(color.muted(` ${preview.workflowName} · ${truncate(preview.message, 60)} · ${lastRun}`)),
  ];
}
