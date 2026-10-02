import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { cachePath, configPath, readConfig } from "./config.js";
import { ghEnvironment } from "./github.js";

const execFileAsync = promisify(execFile);

export interface Diagnostic {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  diagnostics: Diagnostic[];
  ok: boolean;
}

export async function runDoctor(): Promise<DoctorReport> {
  const path = configPath();
  const diagnostics = await Promise.all([
    versionDiagnostic("Node.js", process.execPath, ["--version"]),
    versionDiagnostic("Git", "git", ["--version"]),
    ghDiagnostic(),
    versionDiagnostic("OpenCode", "opencode", ["--version"]),
    cacheDiagnostic(),
    configDiagnostic(path),
  ]);
  return { diagnostics, ok: diagnostics.every((diagnostic) => diagnostic.ok) };
}

export function renderDoctor(report: DoctorReport): string {
  const lines = report.diagnostics.map((diagnostic) => `${diagnostic.ok ? "OK" : "FAIL"}  ${diagnostic.name}: ${diagnostic.detail}`);
  lines.push(report.ok ? "\nDEVflow is ready." : "\nDEVflow needs attention.");
  return `${lines.join("\n")}\n`;
}

async function versionDiagnostic(name: string, command: string, arguments_: string[]): Promise<Diagnostic> {
  try {
    const { stdout, stderr } = await execFileAsync(command, arguments_);
    return { name, ok: true, detail: (stdout || stderr).trim().split("\n")[0] || "available" };
  } catch (error) {
    return { name, ok: false, detail: commandError(error) };
  }
}

async function ghDiagnostic(): Promise<Diagnostic> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", ["auth", "status"], { env: ghEnvironment });
    const detail = (stdout || stderr).trim().split("\n")[0] || "authenticated";
    return { name: "GitHub CLI authentication", ok: true, detail };
  } catch (error) {
    return { name: "GitHub CLI authentication", ok: false, detail: `Run \`gh auth login\`. ${commandError(error)}` };
  }
}

async function cacheDiagnostic(): Promise<Diagnostic> {
  const path = cachePath();
  try {
    await access(path);
    return { name: "Cache", ok: true, detail: path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { name: "Cache", ok: true, detail: `${path} (created when needed)` };
    return { name: "Cache", ok: false, detail: `${path}: ${commandError(error)}` };
  }
}

async function configDiagnostic(path: string): Promise<Diagnostic> {
  try {
    const config = await readConfig(path);
    return { name: "Config", ok: true, detail: `${path} (${Object.keys(config.repositories).length} repositories)` };
  } catch (error) {
    return { name: "Config", ok: false, detail: `${path}: ${commandError(error)}` };
  }
}

function commandError(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0];
  return "unavailable";
}
