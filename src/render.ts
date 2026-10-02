import type { ClassifiedPullRequest, Priority } from "./models.js";
import { color } from "./colors.js";

export const priorities: Array<{ key: Priority; label: string }> = [
  { key: "ready", label: "READY TO MERGE" },
  { key: "action", label: "NEEDS YOUR ACTION" },
  { key: "waiting", label: "WAITING / IN PROGRESS" },
  { key: "blocked", label: "BLOCKED" },
];

export function formatRelativeTime(date: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(date));
}

export function renderList(pullRequests: ClassifiedPullRequest[], login: string): string {
  const counts = countPriorities(pullRequests);
  const lines = [
    color.bold(color.magenta(`DEVflow // @${login} // ${pullRequests.length} OPEN`)),
    `${color.green(`READY ${counts.ready}`)}   ${color.yellow(`ACTION ${counts.action}`)}   ${color.blue(`WAITING ${counts.waiting}`)}   ${color.red(`BLOCKED ${counts.blocked}`)}`,
  ];

  for (const priority of priorities) {
    const items = pullRequests.filter((pullRequest) => pullRequest.priority === priority.key);
    if (items.length === 0) continue;
    lines.push("", color.bold(priorityLabel(priority.key, priority.label)));
    for (const pullRequest of items) {
      lines.push(`  ${priorityTag(pullRequest.priority)} #${pullRequest.number}  ${pullRequest.title}  ${color.muted(`(${pullRequest.repository})`)}`);
      lines.push(`        ${color.muted(`${pullRequest.roles.join(" + ")} · ${pullRequest.reason} · updated ${formatRelativeTime(pullRequest.updatedAt)}`)}`);
    }
  }
  return lines.join("\n");
}

export function priorityTag(priority: Priority): string {
  return priorityLabel(priority, `[${priority.toUpperCase()}]`);
}

export function priorityLabel(priority: Priority, value: string): string {
  if (priority === "ready") return color.green(value);
  if (priority === "action") return color.yellow(value);
  if (priority === "blocked") return color.red(value);
  return color.blue(value);
}

export function countPriorities(pullRequests: ClassifiedPullRequest[]): Record<Priority, number> {
  return pullRequests.reduce<Record<Priority, number>>(
    (counts, pullRequest) => ({ ...counts, [pullRequest.priority]: counts[pullRequest.priority] + 1 }),
    { ready: 0, action: 0, waiting: 0, blocked: 0 },
  );
}
