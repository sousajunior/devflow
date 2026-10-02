import test from "node:test";
import assert from "node:assert/strict";
import { mergePullRequests, summarizeChecks } from "./github.js";
import type { PullRequest } from "./models.js";

const base: PullRequest = {
  number: 42, title: "Example", url: "https://example.test", repository: "acme/one", headRepository: "acme/one", headRefName: "feature/example", author: "me", assignees: [],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", isDraft: false, mergeable: "MERGEABLE",
  reviewDecision: null, checkState: "passing", failingChecks: 0, pendingChecks: 0, checks: [], reviews: [], roles: ["author"],
};

test("keeps pull requests with the same number from different repositories", () => {
  const result = mergePullRequests([base, { ...base, repository: "acme/two", headRepository: "acme/two" }]);
  assert.equal(result.length, 2);
});

test("merges roles only for the same repository pull request", () => {
  const result = mergePullRequests([base, { ...base, roles: ["assignee"] }]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].roles, ["author", "assignee"]);
});

test("keeps safe GitHub Actions identifiers on check runs", () => {
  const result = summarizeChecks([{
    name: "test",
    status: "COMPLETED",
    conclusion: "FAILURE",
    databaseId: 2468,
    checkSuite: { workflowRun: { databaseId: 1357 } },
  }]);
  assert.deepEqual(result.checks[0], {
    name: "test",
    state: "COMPLETED",
    conclusion: "FAILURE",
    url: null,
    workflowRunId: 1357,
    checkRunId: 2468,
  });
});

test("discards unsafe GitHub Actions identifiers", () => {
  const result = summarizeChecks([{
    name: "test",
    status: "COMPLETED",
    conclusion: "FAILURE",
    databaseId: -1,
    checkSuite: { workflowRun: { databaseId: Number.MAX_SAFE_INTEGER + 1 } },
  }]);
  assert.equal(result.checks[0].workflowRunId, null);
  assert.equal(result.checks[0].checkRunId, null);
});
