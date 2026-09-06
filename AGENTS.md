# Repository Guidelines

## Lexical work

For Lexical source inspection, API questions, implementation, debugging, upgrades, peer-range changes, compatibility baselines, or package semver decisions, use `.agents/skills/lexical-compatibility/SKILL.md`.

## Web Editor Revisions source inspection

- Use the sibling checkout at `../web-editor-revisions` first when it exists.
- Resolve pinned versions from its local Git history with `git show <commit>:<path>` instead of assuming the checked-out branch is authoritative.
- Use GitHub or other network access only when the required ref is unavailable locally or current remote state is itself the subject of the investigation.
- Treat changes in the sibling working tree as user-owned; do not modify, stash, discard, or commit them without explicit authorization.

## Sandbox and pnpm

- If a `pnpm` command returns `unable to open database file`, treat it as a likely sandbox or filesystem-permission failure when the pnpm store is outside the workspace, not as a repository or lockfile failure.
- Retry the original `pnpm` command using the agent's available approval or elevated-access mechanism so pnpm can access its existing external store.
- If approval is unavailable or denied, stop and ask the user to approve the required access or run the command outside the sandbox.
- Preserve the existing pnpm store and database; do not delete them or change their ownership or permissions with `sudo`.

## Architecture and tests

- Keep the package root React-free; browser and editor integration belongs in the client entrypoint.

## Commits and pull requests

Use lowercase Conventional Commit-style subjects, such as `fix(test): prevent duplicate Vitest discovery`. Pull requests should explain the change, list validation commands, link a related issue when applicable, and include a screenshot or reproduction steps for visible editor changes. Update `pnpm-lock.yaml` whenever dependency manifests change.

## Repository workflows

### Issue tracker

For reading or changing issues, specs, and issue relationships, follow `docs/agents/issue-tracker.md`.

### Triage labels

For issue triage or label changes, follow `docs/agents/triage-labels.md`.

### Domain docs

Before exploring or changing code, read root `CONTEXT.md` and the ADRs that touch the area. Follow `docs/agents/domain.md`.
