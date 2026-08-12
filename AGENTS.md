# Repository Guidelines

## Project Structure & Module Organization

- `packages/lexical-review/src/` contains the published Lexical review-mode library and its co-located tests (`*.spec.tsx`).
- `packages/demo/src/` contains the React/Vite demonstration application and styling entrypoint.
- `packages/lexical-review/README.md` documents the package entrypoints; the default entrypoint is React-free and suitable for server-side model/serialization imports, while React/editor registration is exposed from `lexical-review/client`.
- Root configuration includes Nx (`nx.json`), TypeScript (`tsconfig.json`), Vitest (`vitest.config.ts`), ESLint (`eslint.config.js`), and the pnpm workspace definition. Deployment and npm publishing workflows are under `.github/workflows/`.

## Build, Test, and Development Commands

Run `pnpm install` for local setup; CI uses `pnpm install --frozen-lockfile`. The repository requires Node `>=22.12.0` and pnpm 11.

- `pnpm dev` — start the demo through Nx.
- `pnpm build:demo` — type-check and build the Vite demo.
- `pnpm --filter lexical-review build` — generate the library declarations and distribution files.
- `pnpm test --run` — run the Vitest suite once in jsdom.
- `pnpm lint` — run ESLint across the workspace.
- `pnpm prettier` — format repository files with Prettier.
- `pnpm preview:demo` — preview the production demo build locally.

## Coding Style & Naming Conventions

Use TypeScript/TSX, two-space indentation, and existing component/module conventions. Components and Lexical nodes use PascalCase (for example, `ReviewTextNode`); functions, hooks, and utilities use camelCase. Keep browser/editor-only code in the client entrypoint. Run `pnpm lint` and `pnpm prettier` before submitting changes.

## Testing Guidelines

Add focused tests beside the implementation in `packages/lexical-review/src/`, using `*.spec.tsx` and descriptive `describe`/`it` blocks. Tests run with Vitest and jsdom. There is no configured coverage threshold; changes to node behavior, serialization, selection, or DOM rendering should include regression coverage.

## Commit & Pull Request Guidelines

Prefer Conventional Commit-style subjects in lowercase, such as `fix(test): prevent duplicate Vitest discovery`, `build: separate TypeScript configs`, or `chore: clean up Tailwind configuration`. Keep commits focused. Pull requests should explain the behavior or configuration change, list validation commands, link a related issue when applicable, and include a demo screenshot or reproduction steps for visible editor changes. Update `pnpm-lock.yaml` whenever dependency manifests change.

## Security & Configuration Tips

Do not commit secrets or local `.env` files. Keep generated `dist/`, coverage, Nx cache, and dependency directories untracked. Preserve the lockfile and the declared Node/pnpm engine requirements so local and CI builds remain reproducible.
