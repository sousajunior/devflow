import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./summarize.js";
import type { PullRequest } from "./models.js";

const base: PullRequest = {
  number: 1, title: "Example", url: "https://example.test", repository: "acme/app", headRepository: "acme/app", headRefName: "feature/example", author: "me", assignees: [],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", isDraft: false, mergeable: "MERGEABLE",
  reviewDecision: null, checkState: "passing", failingChecks: 0, pendingChecks: 0, checks: [], reviews: [], roles: ["author"],
};

test("failing checks block a pull request", () => {
  assert.equal(classify({ ...base, checkState: "failing", failingChecks: 2 }).priority, "blocked");
});

test("requested changes need action", () => {
  assert.equal(classify({ ...base, reviewDecision: "CHANGES_REQUESTED" }).priority, "action");
});

test("approved pull request with completed checks is ready", () => {
  assert.equal(classify({ ...base, reviewDecision: "APPROVED" }).priority, "ready");
});

test("unknown mergeability waits even when a pull request is approved", () => {
  const pullRequest = classify({ ...base, mergeable: "UNKNOWN", reviewDecision: "APPROVED" });
  assert.equal(pullRequest.priority, "waiting");
  assert.equal(pullRequest.reason, "merge status pending");
});

test("a requested review is a personal action", () => {
  const pullRequest = classify({ ...base, roles: ["reviewer"] });
  assert.equal(pullRequest.priority, "action");
  assert.equal(pullRequest.reason, "your review requested");
});

test("changes requested on another authors pull request waits for them", () => {
  const pullRequest = classify({ ...base, author: "someone-else", roles: ["reviewer"], reviewDecision: "CHANGES_REQUESTED" });
  assert.equal(pullRequest.priority, "action");
});

test("changes requested on an assigned pull request waits for its author", () => {
  const pullRequest = classify({ ...base, author: "someone-else", roles: ["assignee"], reviewDecision: "CHANGES_REQUESTED" });
  assert.equal(pullRequest.priority, "waiting");
  assert.equal(pullRequest.reason, "author needs to address review");
});
