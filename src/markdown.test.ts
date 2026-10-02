import test from "node:test";
import assert from "node:assert/strict";
import { renderTerminalMarkdown } from "./markdown.js";

const ansi = /\x1B\[[0-?]*[ -/]*[@-~]/g;

test("renders markdown syntax as terminal output", () => {
  const output = renderTerminalMarkdown("### Required changes\n\n- **Fix** `handler.ts`\n- [Run](https://example.test)").replace(ansi, "");
  assert.doesNotMatch(output, /###|\*\*/);
  assert.match(output, /Required changes/);
  assert.match(output, /Fix/);
  assert.match(output, /handler\.ts/);
  assert.match(output, /https:\/\/example\.test/);
});
