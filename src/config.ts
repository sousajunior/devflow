import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ValidationCommand = [string, ...string[]];

export interface RepositoryConfig {
  validation: ValidationCommand[];
}

export interface DevflowConfig {
  repositories: Record<string, RepositoryConfig>;
}

const defaultConfig: DevflowConfig = { repositories: {} };

export function configPath(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const directory = environment.XDG_CONFIG_HOME || join(home, ".config");
  return join(directory, "devflow", "config.json");
}

export function cachePath(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(environment.XDG_CACHE_HOME || join(home, ".cache"), "devflow");
}

export async function readConfig(path = configPath()): Promise<DevflowConfig> {
  try {
    const contents = await readFile(path, "utf8");
    return parseConfig(contents, path);
  } catch (error) {
    if (isNotFound(error)) return defaultConfig;
    throw error;
  }
}

export async function initializeConfig(path = configPath()): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify(defaultConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export function parseConfig(contents: string, path = "config"): DevflowConfig {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid JSON in ${path}.`);
  }
  if (!isRecord(value) || !isRecord(value.repositories)) throw new Error(`Invalid config in ${path}: expected a repositories object.`);

  const repositories: Record<string, RepositoryConfig> = {};
  for (const [repository, entry] of Object.entries(value.repositories)) {
    if (!repository || !isRecord(entry) || !Array.isArray(entry.validation)) {
      throw new Error(`Invalid config in ${path}: ${JSON.stringify(repository)} must contain a validation command array.`);
    }
    repositories[repository] = { validation: entry.validation.map((command, index) => parseCommand(command, path, repository, index)) };
  }
  return { repositories };
}

function parseCommand(value: unknown, path: string, repository: string, index: number): ValidationCommand {
  if (!Array.isArray(value) || value.length === 0 || value.some((argument) => typeof argument !== "string" || argument.length === 0)) {
    throw new Error(`Invalid config in ${path}: validation command ${index + 1} for ${repository} must be a non-empty array of non-empty strings.`);
  }
  return value as ValidationCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
