import type { ClassifiedPullRequest } from "./models.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface JiraProject { key: string; name: string; }
export interface JiraIssueType { id: string; name: string; subtask: boolean; }

function baseUrl(): string {
  const value = process.env.JIRA_BASE_URL;
  if (!value) throw new Error("Jira base URL is missing. Set JIRA_BASE_URL (e.g. https://your-company.atlassian.net).");
  return value;
}

async function headers(): Promise<HeadersInit> {
  const email = process.env.JIRA_EMAIL || await keyringValue("jira-email");
  const token = process.env.JIRA_API_TOKEN || await keyringValue("jira-token");
  if (!email || !token) throw new Error("Jira credentials are missing. Set JIRA_EMAIL and JIRA_API_TOKEN.");
  return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" };
}

async function jira(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: { ...await headers(), ...init?.headers } });
  if (!response.ok) throw new Error(`Jira request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function keyringValue(credential: "jira-email" | "jira-token"): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("secret-tool", ["lookup", "service", "devflow", "credential", credential]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function jiraProjects(): Promise<JiraProject[]> {
  const value = await jira("/rest/api/3/project/search?maxResults=100") as { values?: Array<{ key: string; name: string }> };
  const projects = value.values ?? [];
  if (projects.length) return normalizeProjects(projects);
  const legacy = await jira("/rest/api/3/project") as Array<{ key: string; name: string }>;
  return normalizeProjects(legacy);
}

function normalizeProjects(projects: Array<{ key: string; name: string }>): JiraProject[] {
  return projects.map((project) => ({ key: project.key, name: project.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function jiraIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const value = await jira(`/rest/api/3/project/${encodeURIComponent(projectKey)}`) as { issueTypes?: Array<{ id: string; name: string; subtask: boolean }> };
  return (value.issueTypes ?? []).filter((type) => !type.subtask).map((type) => ({ id: type.id, name: type.name, subtask: type.subtask }));
}

export async function createJiraIssue(pullRequest: ClassifiedPullRequest, project: JiraProject, issueType: JiraIssueType): Promise<{ key: string; url: string }> {
  const myself = await jira("/rest/api/3/myself") as { accountId: string };
  const summary = `[${pullRequest.repository}#${pullRequest.number}] ${pullRequest.title}`;
  const description = {
    type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `Origem: ${pullRequest.url}\n\nRepositório: ${pullRequest.repository}\nPR: #${pullRequest.number}\nBranch: ${pullRequest.headRefName}\nStatus: ${pullRequest.reason}` }] }],
  };
  const created = await jira("/rest/api/3/issue", { method: "POST", body: JSON.stringify({ fields: { project: { key: project.key }, issuetype: { id: issueType.id }, summary, description, assignee: { accountId: myself.accountId } } }) }) as { key: string };
  return { key: created.key, url: `${baseUrl()}/browse/${created.key}` };
}
