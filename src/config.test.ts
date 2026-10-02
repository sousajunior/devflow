import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configPath, initializeConfig, parseConfig, readConfig } from "./config.js";

test("uses XDG_CONFIG_HOME for the config path", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/tmp/settings" }, "/home/example"), "/tmp/settings/devflow/config.json");
});

test("initializes an empty private config without overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devflow-config-"));
  const path = join(directory, "nested", "config.json");
  assert.equal(await initializeConfig(path), true);
  assert.deepEqual(await readConfig(path), { repositories: {} });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, '{"repositories":{"acme/api":{"validation":[["npm","test"]]}}}\n');
  assert.equal(await initializeConfig(path), false);
  assert.match(await readFile(path, "utf8"), /acme\/api/);
});

test("rejects shell strings and malformed command arrays", () => {
  assert.throws(() => parseConfig('{"repositories":{"acme/api":{"validation":["npm test"]}}}'), /array/);
  assert.throws(() => parseConfig('{"repositories":{"acme/api":{"validation":[["npm", 1]]}}}'), /array/);
});

test("reads repository validation command arrays", () => {
  assert.deepEqual(parseConfig('{"repositories":{"acme/api":{"validation":[["npm","test"],["npm","run","lint"]]}}}'), {
    repositories: { "acme/api": { validation: [["npm", "test"], ["npm", "run", "lint"]] } },
  });
});
