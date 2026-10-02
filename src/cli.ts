#!/usr/bin/env node
import { fetchPullRequests } from "./github.js";
import { listResumableWorktrees } from "./agent.js";
import { renderList } from "./render.js";
import { classifyAll, inboxPullRequests } from "./summarize.js";
import { startTui } from "./tui.js";
import { configPath, initializeConfig, readConfig } from "./config.js";
import { renderDoctor, runDoctor } from "./doctor.js";
import { prepareWrapUp } from "./wrapup.js";

interface Arguments {
  command: "dashboard" | "list" | "inbox" | "resume" | "doctor" | "config" | "wrap-up";
  selector?: string;
  configAction?: "path" | "show" | "init";
  json: boolean;
  includeAuthor: boolean;
  includeAssignee: boolean;
  includeReviewer: boolean;
  repository?: string;
  organization?: string;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.command === "doctor") {
    const report = await runDoctor();
    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (args.command === "config") {
    await runConfig(args.configAction ?? "show");
    return;
  }
  if (args.command === "resume") {
    const worktrees = await listResumableWorktrees();
    process.stdout.write(renderResume(worktrees));
    return;
  }
  if (args.command === "wrap-up") {
    if (!args.selector) throw new Error("wrap-up requires OWNER/REPO#NUMBER.");
    process.stdout.write(renderWrapUp(await prepareWrapUp(args.selector)));
    return;
  }
  const load = async () => classifyAll((await fetchPullRequests(args)).pullRequests);
  const { login, pullRequests } = await fetchPullRequests(args);
  const classified = classifyAll(pullRequests);
  const displayed = args.command === "inbox" ? inboxPullRequests(classified) : classified;

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ login, pullRequests: displayed }, null, 2)}\n`);
    return;
  }
  if (args.command === "list" || args.command === "inbox" || !process.stdout.isTTY) {
    process.stdout.write(`${renderList(displayed, login)}\n`);
    return;
  }
  await startTui({ login, pullRequests: classified, refresh: load });
}

function parseArguments(values: string[]): Arguments {
  const args: Arguments = { command: "dashboard", json: false, includeAuthor: true, includeAssignee: true, includeReviewer: true };
  let roleWasSelected = false;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === "list" || value === "inbox" || value === "resume" || value === "doctor") args.command = value;
    else if (value === "wrap-up") { args.command = value; args.selector = values[++index]; }
    else if (value === "config") {
      args.command = value;
      const action = values[index + 1];
      if (action === "path" || action === "show" || action === "init") {
        args.configAction = action;
        index++;
      }
    }
    else if (value === "--json") args.json = true;
    else if (value === "--mine") {
      if (!roleWasSelected) { args.includeAuthor = false; args.includeAssignee = false; args.includeReviewer = false; roleWasSelected = true; }
      args.includeAuthor = true;
    } else if (value === "--assigned") {
      if (!roleWasSelected) { args.includeAuthor = false; args.includeAssignee = false; args.includeReviewer = false; roleWasSelected = true; }
      args.includeAssignee = true;
    } else if (value === "--reviewer") {
      if (!roleWasSelected) { args.includeAuthor = false; args.includeAssignee = false; args.includeReviewer = false; roleWasSelected = true; }
      args.includeReviewer = true;
    } else if (value === "--repo" || value === "--org") {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value.`);
      if (value === "--repo") args.repository = next;
      else args.organization = next;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}. Run \`devflow --help\`.`);
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(`Usage: devflow [list|inbox|resume|doctor|config|wrap-up] [options]\n\nCommands:\n  inbox            Show only items that require your action\n  resume           Show generated worktrees with local changes\n  wrap-up REPO#PR  Inspect a worktree and run configured validations\n  doctor           Check local DEVflow prerequisites\n  config path      Print the XDG configuration path\n  config show      Print the local configuration\n  config init      Create an empty local configuration\n\nOptions:\n  --mine           Include PRs authored by you\n  --assigned       Include PRs assigned to you\n  --reviewer       Include PRs where your review was requested\n  --repo OWNER/REPO  Limit results to a repository\n  --org ORG        Limit results to an organization\n  --json           Print machine-readable JSON\n  -h, --help       Show this help\n`);
}

async function runConfig(action: NonNullable<Arguments["configAction"]>): Promise<void> {
  if (action === "path") {
    process.stdout.write(`${configPath()}\n`);
    return;
  }
  if (action === "init") {
    const created = await initializeConfig();
    process.stdout.write(created ? `Created ${configPath()}\n` : `Config already exists: ${configPath()}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(await readConfig(), null, 2)}\n`);
}

function renderResume(worktrees: Awaited<ReturnType<typeof listResumableWorktrees>>): string {
  if (worktrees.length === 0) return "No resumable DEVflow worktrees found.\n";
  return `${worktrees.map((worktree) => `#${worktree.number}  ${worktree.title}\n    ${worktree.repository} · ${worktree.dirty ? "local changes" : "clean"} · ${worktree.updatedAt}\n    ${worktree.worktree}`).join("\n\n")}\n`;
}

function renderWrapUp(report: Awaited<ReturnType<typeof prepareWrapUp>>): string {
  const validations = report.validations.length ? report.validations.map((item) => `${item.ok ? "OK" : "FAIL"}  ${item.command}\n${item.output || "(no output)"}`).join("\n\n") : "No configured validations.";
  return `WRAP-UP DRY RUN // ${report.worktree.repository}#${report.worktree.number}\n\nFILES\n${report.status || "No local changes."}\n\nDIFF\n${report.diffStat || "No diff."}\n\nWHITESPACE\n${report.whitespace || "OK"}\n\nVALIDATIONS\n${validations}\n\nNo commit or push was performed.\n`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected failure.";
  process.stderr.write(`devflow: ${message}\n`);
  process.exitCode = 1;
});
