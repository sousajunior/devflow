export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
export type CheckState = "passing" | "failing" | "pending" | "none" | "unknown";
export type Priority = "ready" | "action" | "waiting" | "blocked";

export interface PullRequestCheck {
  name: string;
  state: string;
  conclusion: string | null;
  url: string | null;
  workflowRunId: number | null;
  checkRunId: number | null;
}

export interface PullRequestReview {
  author: string;
  state: string;
  submittedAt: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  repository: string;
  headRepository: string | null;
  headRefName: string;
  author: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: ReviewDecision;
  checkState: CheckState;
  failingChecks: number;
  pendingChecks: number;
  checks: PullRequestCheck[];
  reviews: PullRequestReview[];
  roles: Array<"author" | "assignee" | "reviewer">;
}

export interface ClassifiedPullRequest extends PullRequest {
  priority: Priority;
  reason: string;
}
