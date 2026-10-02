import type { ClassifiedPullRequest, PullRequest } from "./models.js";

export function classify(pullRequest: PullRequest): ClassifiedPullRequest {
  if (pullRequest.mergeable === "CONFLICTING") return { ...pullRequest, priority: "blocked", reason: "merge conflict" };
  if (pullRequest.mergeable === "UNKNOWN") return { ...pullRequest, priority: "waiting", reason: "merge status pending" };
  if (pullRequest.checkState === "failing") {
    const subject = pullRequest.roles.includes("author") ? "your PR" : "CI";
    return { ...pullRequest, priority: "blocked", reason: `${subject}: ${pullRequest.failingChecks} failing check${pullRequest.failingChecks === 1 ? "" : "s"}` };
  }
  if (pullRequest.isDraft) return { ...pullRequest, priority: "waiting", reason: "draft" };
  if (pullRequest.roles.includes("reviewer")) return { ...pullRequest, priority: "action", reason: "your review requested" };
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
    return pullRequest.roles.includes("author")
      ? { ...pullRequest, priority: "action", reason: "changes requested on your PR" }
      : { ...pullRequest, priority: "waiting", reason: "author needs to address review" };
  }
  if (pullRequest.reviewDecision === "APPROVED" && pullRequest.checkState !== "pending") {
    return { ...pullRequest, priority: "ready", reason: pullRequest.checkState === "none" ? "approved" : "approved, checks passing" };
  }
  if (pullRequest.checkState === "pending") {
    return { ...pullRequest, priority: "waiting", reason: `${pullRequest.pendingChecks} check${pullRequest.pendingChecks === 1 ? "" : "s"} running` };
  }
  if (pullRequest.reviewDecision === "REVIEW_REQUIRED") return { ...pullRequest, priority: "waiting", reason: "review pending" };
  return { ...pullRequest, priority: "waiting", reason: "awaiting status" };
}

export function classifyAll(pullRequests: PullRequest[]): ClassifiedPullRequest[] {
  return pullRequests.map(classify);
}

export function inboxPullRequests(pullRequests: ClassifiedPullRequest[]): ClassifiedPullRequest[] {
  return pullRequests
    .filter((pullRequest) => pullRequest.priority === "action" || (pullRequest.priority === "blocked" && pullRequest.roles.includes("author")))
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}
