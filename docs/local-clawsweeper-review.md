# Local ClawSweeper Review

Read when setting up a maintainer laptop to run ClawSweeper locally before
submitting, updating, or merging a pull request.

## Scope

Local ClawSweeper review is an advisory maintainer workflow. It runs the same
review command path from a local ClawSweeper checkout and writes a local
artifact. It does not post GitHub comments, apply decisions, merge pull
requests, or replace the trusted hosted ClawSweeper check.

Use it to answer: "What would ClawSweeper say about this PR right now?"

## One-Time Setup

Clone ClawSweeper and install dependencies:

```sh
git clone https://github.com/openclaw/clawsweeper.git
cd clawsweeper
corepack enable
pnpm install
pnpm run build:all
```

Authenticate the GitHub CLI with read access to the target repository:

```sh
gh auth status
gh auth login
```

Authenticate the local Codex CLI. Device auth avoids putting API keys in shell
history or repository files:

```sh
codex login --device-auth -c 'service_tier="fast"'
pnpm run codex:local:check
```

If a maintainer prefers API-key auth, pipe the key into the Codex CLI auth store
for that one command, then remove the environment variable.

PowerShell:

```powershell
$env:OPENAI_API_KEY = Read-Host "OpenAI API key"
$env:OPENAI_API_KEY | codex login --with-api-key -c 'service_tier="fast"'
Remove-Item Env:OPENAI_API_KEY
pnpm run codex:local:check
```

POSIX shell:

```sh
printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key -c 'service_tier="fast"'
unset OPENAI_API_KEY
pnpm run codex:local:check
```

## Target Checkout Modes

By default, an exact local PR review manages its own target checkout. With
`--item-number <pr-number>` and no `--target-dir`, ClawSweeper clones the PR ref
under `artifacts/local-review-<pr-number>/target` and reviews that checkout.

To review an already-cloned checkout, or to review an issue, pass
`--target-dir`. Use a clean checkout of the repository being reviewed. A
dedicated target checkout avoids interfering with normal development work:

```sh
git clone https://github.com/openclaw/openclaw.git ../openclaw-clawsweeper-target
git -C ../openclaw-clawsweeper-target status --short
git -C ../openclaw-clawsweeper-target fetch origin main
git -C ../openclaw-clawsweeper-target switch main
git -C ../openclaw-clawsweeper-target pull --ff-only origin main
```

Do not switch branches, pull, or overwrite files in a dirty supplied target
checkout.

## Run A PR Review

Run one pull request per command. Avoid `--item-numbers` for this maintainer
workflow; one-at-a-time runs keep artifacts and logs tied to one PR and avoid
shell argument parsing surprises.

From the ClawSweeper checkout:

```sh
pnpm run review -- --local-only --item-number <pr-number>
```

PowerShell:

```powershell
pnpm run review -- --local-only --item-number <pr-number>
```

To use a supplied checkout instead:

```sh
pnpm run review -- --local-only \
  --item-number <pr-number> \
  --target-dir ../openclaw-clawsweeper-target
```

The exact local command prints a maintainer-oriented progress summary by
default. Add `--verbose` when debugging checkout, selection, or Codex process
details.

Read the report at:

```text
artifacts/local-review-<pr-number>/<pr-number>.md
```

Key fields to check:

- `review_status`
- `main_sha`
- `pull_head_sha`
- `decision`
- `confidence`
- `review_service_tier`
- `review_codex_elapsed_ms`
- `Review Findings`
- `Real Behavior Proof`

If `review_status` is `failed`, fix the local setup issue first. A short timeout
is the most common false failure; use the documented 10-minute timeout for a
real review.

## Optional Codex Skill

The CLI workflow works without a skill. The skill is only an ergonomic wrapper
for Codex-driven setup and repeat use. It lets a maintainer ask:

```text
Use $local-clawsweeper-review to run a local ClawSweeper review for PR <number>.
```

The ClawSweeper repository ships a repo-local skill at:

```text
.agents/skills/local-clawsweeper-review
```

Prefer copying the shipped skill from the ClawSweeper checkout instead of
manually recreating it.

Maintainers who want the skill available from any checkout can copy it into
their Codex user skills directory.

PowerShell:

```powershell
$dest = Join-Path $env:USERPROFILE ".codex\skills\local-clawsweeper-review"
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Copy-Item -Recurse -Force .agents\skills\local-clawsweeper-review $dest
```

POSIX shell:

```sh
mkdir -p ~/.codex/skills
cp -R .agents/skills/local-clawsweeper-review ~/.codex/skills/
```

If this guide is being used outside a ClawSweeper checkout, first clone
`openclaw/clawsweeper`, then copy the shipped skill from that checkout. If the
skill directory is unavailable, ask Codex to create a skill named
`local-clawsweeper-review` using the workflow in this document.

Bootstrap prompt:

```text
Follow docs/local-clawsweeper-review.md. Clone openclaw/clawsweeper if needed,
copy the shipped .agents/skills/local-clawsweeper-review skill into my Codex
user skills directory, authenticate my own gh and Codex CLI, then run one local
ClawSweeper review at a time.
```

Fallback skill creation prompt:

```text
Create a Codex skill named local-clawsweeper-review. Its workflow is:
use a clean ClawSweeper checkout, run pnpm run codex:local:check, run
pnpm run review -- --local-only --item-number <pr-number> for one PR at a time, read
artifacts/local-review-<pr>/<pr>.md, summarize
review_status/main_sha/pull_head_sha/decision/confidence/findings, and do not
post GitHub comments or run apply/repair/merge commands unless explicitly asked.
```

If Codex needs the exact skill files, create this directory:

```text
~/.codex/skills/local-clawsweeper-review
```

Then write `SKILL.md`:

````md
---
name: local-clawsweeper-review
description: Run a local ClawSweeper issue or PR review before submitting or updating a pull request, including Codex CLI auth preflight, exact-item review command, artifact inspection, and no-GitHub-mutation safety. Use when asked to run local ClawSweeper, local clawsweeper review, pre-PR ClawSweeper check, or verify a PR with ClawSweeper locally.
---

# Local ClawSweeper Review

Use this skill for advisory local ClawSweeper output before PR submission,
update, or merge.

## Safety

- Run one PR at a time with `pnpm run review -- --local-only`.
- Do not run `apply-artifacts`, `apply-decisions`, repair, merge, or GitHub
  comment commands unless the user explicitly asks for that mutation.
- Do not print `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, GitHub
  tokens, or Codex auth material.
- Treat generated artifacts as local proof, not hosted ClawSweeper approval.

## Setup

From the ClawSweeper checkout:

```sh
corepack enable
pnpm install
pnpm run build:all
pnpm run codex:local:check
```

If Codex CLI auth is missing, ask the operator to run:

```sh
codex login --device-auth -c 'service_tier="fast"'
pnpm run codex:local:check
```

## Target Checkout Modes

By default, an exact local PR review manages its own target checkout under
`artifacts/local-review-<pr-number>/target`.

Pass `--target-dir` when the operator wants to review an existing checkout or
an issue. Use a clean supplied target checkout. For OpenClaw:

```sh
git -C <target-dir> status --short
git -C <target-dir> fetch origin main
git -C <target-dir> switch main
git -C <target-dir> pull --ff-only origin main
```

Do not switch, pull, or overwrite a dirty target checkout.

## Run

From the ClawSweeper checkout:

```sh
pnpm run review -- --local-only --item-number <pr-number>
```

To use a supplied checkout:

```sh
pnpm run review -- --local-only \
  --item-number <pr-number> \
  --target-dir <target-dir>
```

The exact local command prints a maintainer-oriented progress summary by
default. Add `--verbose` when debugging checkout, selection, or Codex process
details.

## Readout

Read `artifacts/local-review-<pr-number>/<pr-number>.md` and summarize:

- `review_status`
- `main_sha`
- `pull_head_sha`
- `decision`
- `confidence`
- findings or blockers
- exact auth/runtime failure if the run failed

Before reporting success, confirm `review --local-only` was used and
any supplied target checkout stayed clean.
````

Optionally write `agents/openai.yaml`:

```yaml
interface:
  display_name: "Local ClawSweeper Review"
  short_description: "Run local ClawSweeper before PRs"
  default_prompt: "Use $local-clawsweeper-review to run a local ClawSweeper review before I submit a PR."
```

Copying the shipped skill is still preferred so updates stay reviewable in the
ClawSweeper repository, but the guide now contains enough detail for Codex to
create the optional skill when only this file is available.

## Maintainers Repo Blurb

Suggested text for the OpenClaw maintainers repo:

```md
## Local ClawSweeper self-check

Maintainers can run an advisory local ClawSweeper review before asking the
hosted bot to re-review a PR. Clone `openclaw/clawsweeper`, follow
`docs/local-clawsweeper-review.md`, authenticate your own Codex CLI with
`codex login --device-auth -c 'service_tier="fast"'`, and run
`pnpm run review -- --local-only --item-number <pr-number>`.

Local output is for maintainer triage only. It does not replace hosted
ClawSweeper checks, GitHub comments, merge gates, or automerge approval.
```

## Safety Notes

- Local review uses each maintainer's own Codex CLI auth.
- Do not commit API keys, Codex auth files, or GitHub tokens.
- `review --local-only` skips the starter GitHub comment and writes a local
  artifact.
- Do not run `apply-artifacts`, `apply-decisions`, or repair/automerge commands
  unless the maintainer explicitly wants GitHub mutation.
