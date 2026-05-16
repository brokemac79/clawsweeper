# Triage Dashboard

Read when changing the read-only ClawSweeper advisory-label triage surface.

The triage dashboard is a maintainer visibility surface for open issues. It
does not mutate GitHub issues, project items, labels, comments, closes, or
repair state. It reads GitHub Search results server-side, caches a short-lived
snapshot, and renders views from labels that ClawSweeper already applies.

## Routes

- `/triage`: browser UI for advisory-label views
- `/api/triage`: JSON snapshot used by the UI

The existing live pipeline dashboard remains at `/`.

## Data Model

The worker discovers labels in the target repository whose names start with
`clawsweeper:`. That lets newly-created ClawSweeper labels appear in the broad
view without adding each one to a project board or changing browser-side code.

The focused views are derived from fixed high-signal label combinations:

| View                    | Query shape                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| ClawSweeper             | any discovered `clawsweeper:` label                                         |
| Ready candidates        | `clawsweeper:queueable-fix` without `clawsweeper:no-new-fix-pr`             |
| Queueable but blocked   | `clawsweeper:queueable-fix` and `clawsweeper:no-new-fix-pr`                 |
| Already has PR          | `clawsweeper:linked-pr-open`                                                |
| Needs info              | `clawsweeper:needs-info`                                                    |
| Needs maintainer review | `clawsweeper:needs-maintainer-review`                                       |
| Product or security     | `clawsweeper:needs-product-decision` or `clawsweeper:needs-security-review` |
| Needs live repro        | `clawsweeper:needs-live-repro`                                              |

Each view stores the GitHub query, total count, and the newest matching issues
up to `TRIAGE_ITEMS_PER_VIEW`.

The issue table includes assignees and, for issues carrying
`clawsweeper:linked-pr-open`, linked pull requests from GitHub timeline data. It
defaults to newest created issue first. Maintainers can filter the loaded
snapshot by title, issue number, author, assignee, linked PR number or state,
repository, priority, or label, and can switch the local sort between created
time, issue number, update time, and comment count without changing GitHub
state.

Priority values and label chips are clickable shortcuts. Clicking a chip writes
that value into the filter box and narrows the current view in place.

The table is browser-local state only. Issue titles wrap so maintainers can
read more context without opening GitHub, and each column can be resized from
the header edge. Column widths are saved in `localStorage`; they do not affect
other users or any GitHub state.

## Local Development

Use an authenticated GitHub token for stable Search API limits:

```bash
GITHUB_TOKEN="$(gh auth token)" \
TRIAGE_TARGET_REPOS="openclaw/openclaw" \
pnpm run dashboard:dev
```

Then open:

```text
http://127.0.0.1:8787/triage
```

Set `TRIAGE_CACHE_TTL_SECONDS` to lower values while testing. The default is
two minutes.

## Boundaries

Keep this dashboard read-only:

- no GitHub Project writes
- no label mutations
- no comments
- no close or merge actions
- no repair dispatch

If a future iteration adds actions, they should use a separate explicit
maintainer-controlled flow rather than piggybacking on advisory labels.

## Future Ideas

A later phase could add assignee suggestions or auto-assignment rules. For
example, a `clawsweeper:needs-product-decision` issue mentioning Telegram could
suggest or assign the maintainer who owns Telegram behavior. That should be
designed separately from this read-only dashboard, with clear ownership rules,
auditability, and an opt-in maintainer-controlled path before any GitHub
assignee mutation happens.
