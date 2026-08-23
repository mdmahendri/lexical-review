# Dual-module package build

The published `lexical-review` package follows Lexical's dual-module architecture: Rolldown bundles the runtime entrypoints to ESM `.mjs` and CommonJS `.js` files, while TypeScript emits the `.d.ts` declarations. The package intentionally omits `"type": "module"` and keeps internal TypeScript imports extensionless so the generated declarations remain compatible with NodeNext consumers, while the export map selects the correct runtime for `import` and `require`.

The package contract tests both conditions for the React-free root entrypoint and the React/editor client entrypoint. Because the contract describes the published package, its coverage and the build migration are one architectural seam: changes to the export map, runtime output, or declarations should be evaluated together.

## Considered options

- Keep `"type": "module"` and emit `.js` ESM: this requires extensionful internal imports in generated declarations and does not match the Lexical package shape.
- Let TypeScript emit runtime JavaScript and declarations: this does not provide the intended dual ESM/CommonJS output layout.
