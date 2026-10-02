import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listResumableWorktrees, type ResumableWorktree } from "./agent.js";
import { readConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface WrapUpReport {
  worktree: ResumableWorktree;
  status: string;
  diffStat: string;
  whitespace: string;
  validations: Array<{ command: string; ok: boolean; output: string }>;
}

export async function prepareWrapUp(selector: string): Promise<WrapUpReport> {
  const worktree = (await listResumableWorktrees()).find((item) => `${item.repository}#${item.number}` === selector);
  if (!worktree) throw new Error(`No resumable worktree found for ${selector}.`);
  const config = await readConfig();
  const [status, diffStat, whitespace] = await Promise.all([
    git(worktree.worktree, ["status", "--short"]),
    git(worktree.worktree, ["diff", "--stat"]),
    git(worktree.worktree, ["diff", "--check"]),
  ]);
  const validations = await Promise.all((config.repositories[worktree.repository]?.validation ?? []).map(async (command) => {
    try {
      const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), { cwd: worktree.worktree, maxBuffer: 2 * 1024 * 1024, timeout: 600_000 });
      return { command: command.join(" "), ok: true, output: `${stdout}${stderr}`.trim() };
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string };
      return { command: command.join(" "), ok: false, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
    }
  }));
  return { worktree, status, diffStat, whitespace, validations };
}

async function git(cwd: string, arguments_: string[]): Promise<string> {
  try { return (await execFileAsync("git", ["-C", cwd, ...arguments_])).stdout.trim(); }
  catch (error) { const result = error as { stdout?: string; stderr?: string }; return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(); }
}
