# Repository Guidelines

## Lexical work

For Lexical source inspection, API questions, implementation, debugging, upgrades, peer-range changes, compatibility baselines, or package semver decisions, use `.agents/skills/lexical-compatibility/SKILL.md`.

## Web Editor Revisions source inspection

- Use the sibling checkout at `../web-editor-revisions` first when it exists.
- Resolve pinned versions from its local Git history with `git show <commit>:<path>` instead of assuming the checked-out branch is authoritative.
- Use GitHub or other network access only when the required ref is unavailable locally or current remote state is itself the subject of the investigation.
- Treat changes in the sibling working tree as user-owned; do not modify, stash, discard, or commit them without explicit authorization.

## Codex Sandbox and pnpm

- If a `pnpm` command returns `unable to open database file`, treat it as a pnpm store write-permission failure when the configured store is outside the workspace (commonly `$PNPM_HOME/store`), not as a repository or lockfile failure.
- Retry the same command once with the tool's escalated filesystem-access mode (`require_escalated`) so the user can approve it, and explain that pnpm needs to update its local SQLite store outside the workspace.
- After escalation succeeds, continue pnpm-dependent validation with that access mode. If escalation is unavailable or denied, stop and ask the user to approve it or run the command in a normal terminal.
- Preserve the existing pnpm store and database; do not delete it or change its ownership with `sudo`.

## Architecture and tests

- Keep the package root React-free; browser and editor integration belongs in the client entrypoint.
- Keep `<ins>` and `<del>` as the outermost review wrappers, with Lexical formatting and inline styles nested inside them. Preserve this invariant with real editor reconciliation tests.
- Co-locate focused library tests in `packages/lexical-review/src/`. Use `*.spec.ts` without JSX and `*.spec.tsx` when the test contains JSX. Add regression coverage for changes to node behavior, serialization, selection, or DOM rendering.

## Commits and pull requests

Use lowercase Conventional Commit-style subjects, such as `fix(test): prevent duplicate Vitest discovery`. Pull requests should explain the change, list validation commands, link a related issue when applicable, and include a screenshot or reproduction steps for visible editor changes. Update `pnpm-lock.yaml` whenever dependency manifests change.

## Repository workflows

### Issue tracker

For reading or changing issues, specs, and issue relationships, follow `docs/agents/issue-tracker.md`.

### Triage labels

For issue triage or label changes, follow `docs/agents/triage-labels.md`.

### Domain docs

Before exploring or changing code, read root `CONTEXT.md` and the ADRs that touch the area. Follow `docs/agents/domain.md`.
