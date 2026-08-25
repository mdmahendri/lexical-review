# Repository Guidelines

## Project Structure & Module Organization

- `packages/lexical-review/src/` contains the published Lexical review-mode library and its co-located tests (`*.spec.tsx`).
- `packages/demo/src/` contains the React/Vite demonstration application and styling entrypoint.
- `packages/lexical-review/README.md` documents the package entrypoints; the default entrypoint is React-free and suitable for server-side model/serialization imports, while React/editor registration is exposed from `lexical-review/client`.
- Root configuration includes Nx (`nx.json`), TypeScript (`tsconfig.json`), Vitest (`vitest.config.ts`), ESLint (`eslint.config.js`), and the pnpm workspace definition. Deployment and npm publishing workflows are under `.github/workflows/`.
- The published package architecture is recorded in [ADR 0001](docs/adr/0001-dual-module-package-build.md). Read it when reviewing package exports, module format, declaration emission, or build tooling; those changes are one architectural seam.

## Lexical work

For Lexical source inspection, API questions, implementation, debugging, upgrades, peer-range changes, compatibility baselines, or package semver decisions, use `.agents/skills/lexical-compatibility/SKILL.md`.

- Resolve exact versions from every relevant package manifest and `pnpm-lock.yaml`; prose and examples never define the current supported version.
- The skill has read-only reference and compatibility-decision modes. It never creates a GitHub issue without explicit user authorization.

## Build, Test, and Development Commands

Run `pnpm install` for local setup; CI uses `pnpm install --frozen-lockfile`. The repository requires Node `^22.13.0` or `>=24` and pnpm 11.

- `pnpm dev` — start the demo through Nx.
- `pnpm build:demo` — type-check and build the Vite demo.
- `pnpm --filter lexical-review build` — generate the library declarations and distribution files.
- `pnpm test --run` — run the Vitest suite once in jsdom.
- `pnpm lint` — run ESLint across the workspace.
- `pnpm prettier` — format repository files with Prettier.
- `pnpm preview:demo` — preview the production demo build locally.

## Codex Sandbox and pnpm

- If a `pnpm` command returns `unable to open database file`, treat it as a pnpm store write-permission failure when the configured store is outside the workspace (commonly `$PNPM_HOME/store`), not as a repository or lockfile failure.
- Retry the same command once with the tool's escalated filesystem-access mode (`require_escalated`) so the user can approve it, and explain that pnpm needs to update its local SQLite store outside the workspace.
- After escalation succeeds, continue pnpm-dependent validation with that access mode. If escalation is unavailable or denied, stop and ask the user to approve it or run the command in a normal terminal.
- Preserve the existing pnpm store and database; do not delete it or change its ownership with `sudo`.

## Coding Style & Naming Conventions

Use TypeScript/TSX, two-space indentation, and existing component/module conventions. Components and Lexical nodes use PascalCase (for example, `ReviewTextNode`); functions, hooks, and utilities use camelCase. Keep browser/editor-only code in the client entrypoint. Run `pnpm lint` and `pnpm prettier` before submitting changes.

Review DOM invariant: insertion and deletion markers (`<ins>` and `<del>`) are the outermost wrappers; Lexical formatting and inline styles are nested inside them. Preserve this with real editor reconciliation tests.

## Testing Guidelines

Add focused tests beside the implementation in `packages/lexical-review/src/`, using `*.spec.tsx` and descriptive `describe`/`it` blocks. Tests run with Vitest and jsdom. There is no configured coverage threshold; changes to node behavior, serialization, selection, or DOM rendering should include regression coverage.

## Commit & Pull Request Guidelines

Prefer Conventional Commit-style subjects in lowercase, such as `fix(test): prevent duplicate Vitest discovery`, `build: separate TypeScript configs`, or `chore: clean up Tailwind configuration`. Keep commits focused. Pull requests should explain the behavior or configuration change, list validation commands, link a related issue when applicable, and include a demo screenshot or reproduction steps for visible editor changes. Update `pnpm-lock.yaml` whenever dependency manifests change.

## Security & Configuration Tips

Do not commit secrets or local `.env` files. Keep generated `dist/`, coverage, Nx cache, and dependency directories untracked. Preserve the lockfile and the declared Node/pnpm engine requirements so local and CI builds remain reproducible.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `mahendrimd/lexical-review`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
