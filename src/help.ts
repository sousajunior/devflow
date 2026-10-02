import { readFileSync } from "node:fs";

export const helpMarkdown = readFileSync(new URL("../docs/HELP.md", import.meta.url), "utf8");
