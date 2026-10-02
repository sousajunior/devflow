# DEVflow

DEVflow is a keyboard-driven terminal dashboard for the GitHub pull requests you authored or that are assigned to you. It uses your existing GitHub CLI authentication and never stores a token.

DEVflow deliberately uses the account configured through `gh auth login`, rather than `GH_TOKEN` or `GITHUB_TOKEN` from the shell. This prevents a restricted environment token from hiding private organization repositories from the dashboard.

## Requirements

- Node.js 20 or later
- [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login`

## Jira Credentials

Jira card creation requires `JIRA_BASE_URL` (e.g. `https://your-company.atlassian.net`) in the environment, plus `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment or the system keyring. To persist the email and token securely with GNOME Keyring/libsecret:

```bash
printf '%s' 'your-email@example.com' | secret-tool store --label='DEVflow Jira email' service devflow credential jira-email
read -rsp 'Atlassian API token: ' token; printf '%s' "$token" | secret-tool store --label='DEVflow Jira token' service devflow credential jira-token; unset token; printf '\n'
```

## Run locally

```bash
npm install
npm run build
npm link
devflow
```

Run `devflow` in a terminal to open the interactive dashboard. It categorizes PRs by their latest review state, check runs, and merge conflicts.

## Keyboard controls

| Key | Action |
| --- | --- |
| Arrow keys | Move selection |
| `Enter` | View details |
| `Tab` | Switch between your PRs/assignments, requested reviews, and help |
| `1`-`4` | Filter: ready, action needed, waiting, blocked |
| `0` | Show all PRs |
| `o` | Open selected PR in the browser |
| `d` | Request a staging deployment from the `staging` branch |
| `j` | Create a Jira card from the selected PR details |
| `a` | Analyze the selected PR's review feedback with OpenCode |
| `c` | In PR details, select an inspectable failed GitHub Actions check |
| `g` | Inspect the generated worktree after AI implementation |
| `s` | Return to the AI implementation report |
| `c` | Commit the worktree changes after AI implementation |
| `p` | Push the committed changes to the pull request's branch |
| `r` | Refresh from GitHub |
| `q` | Quit |

Staging deployment first loads a preview with the selected workflow, current `staging` SHA, latest commit and most recent workflow run. It requires an explicit `y` confirmation before dispatching with `--ref staging` and `ENVIRONMENT=staging`.

## Review AI

Press `a` on a PR to collect its diff, reviews, inline comments, and conversation comments. DEVflow gives that context to OpenCode in read-only mode and renders a triage. OpenCode events stream back to DEVflow, which completes the UI action as soon as the agent emits its final step. No checkout or source-file changes happen during analysis; press `x` to cancel an active analysis.

From the triage view, press `i` to request implementation. After another `y` confirmation, DEVflow clones/caches the repository and creates an isolated worktree under `~/.cache/devflow/worktrees/`. OpenCode is launched with that worktree as its working directory and is instructed not to commit, push, deploy, or alter GitHub state; review the worktree before making any commit yourself. This is not a security sandbox: `--auto` grants the agent tool permissions, so use implementation only for code you trust.

Implementation progress (cloning, fetching, OpenCode steps) is shown live. The estimated OpenCode cost and the full implementation report are saved to `~/.cache/devflow/analyses/<repo>-<number>/implementation-report.md`, so they survive closing DEVflow; `devflow resume` and the Worktrees tab point to this file.

Once you have reviewed the worktree, press `c` to commit all local changes with an automated message, then `p` to push that commit directly onto the pull request's existing branch (`git push`, no force). Both require an explicit `y` confirmation; pushing updates the open pull request and triggers its CI.

## CI diagnosis

In a PR's details, press `c` to select an actionable failed GitHub Actions check. DEVflow only offers checks whose GraphQL check run and workflow run IDs are positive safe integers. Press `o` to open the selected workflow run, or `Enter` to request a read-only pt-BR OpenCode diagnosis using a bounded failed-log excerpt.

The CI diagnosis cannot create a worktree or implement changes, and it is explicitly instructed not to modify files, create commits, push, deploy, rerun workflows, or change GitHub state. The log excerpt is untrusted data and may be truncated.

## Non-interactive use

```bash
devflow list
devflow list --assigned
devflow inbox
devflow resume
devflow doctor
devflow config init
devflow list --reviewer
devflow list --mine --repo acme/service
devflow list --org acme --json
```

`--mine` includes PRs you authored; `--assigned` includes PRs assigned to you; `--reviewer` includes PRs where your review is requested. With no role option, all three are included. `devflow inbox` shows only reviews, requested changes, or blocked PRs that require your attention.

`devflow resume` lists worktrees created by AI implementation that still exist locally, including whether they contain uncommitted changes.

## Local configuration

`devflow config path` prints the configuration location. It follows XDG paths: `$XDG_CONFIG_HOME/devflow/config.json`, or `~/.config/devflow/config.json` when `XDG_CONFIG_HOME` is unset. Use `devflow config init` to create an empty, owner-only configuration file and `devflow config show` to inspect it.

Repository validation commands are stored as executable argument arrays, not shell strings. This prevents shell interpolation when validations are used by a future workflow:

```json
{
  "repositories": {
    "acme/service": {
      "validation": [["npm", "test"], ["npm", "run", "lint"]]
    }
  }
}
```

`devflow doctor` reports the local Node.js, Git, GitHub CLI authentication, OpenCode, cache, and configuration status. It does not alter repository or remote state.

## Classification

- **Ready to merge**: approved, with no pending or failing checks.
- **Needs your action**: changes have been requested.
- **Waiting / in progress**: drafts, pending checks, or a review has not been decided.
- **Blocked**: merge conflicts or failing checks.

GitHub only returns the information your existing account can access. The initial query retrieves up to 100 authored and 100 assigned PRs, then merges duplicate results.
