import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ["**/dist/**", "**/.nx/**", "**/coverage/**"] },
  { files: ["**/*.{ts,tsx}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/lexical-review/package-contract/fixtures/*.{cts,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["packages/lexical-review/package-contract/fixtures/*.cjs"],
    languageOptions: {
      globals: {
        require: "readonly",
      },
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    plugins: {
      "@eslint-react": eslintReact,
    },
    rules: {
      // These are the React rules used by this repository. The TypeScript
      // compiler already owns type-driven JSX checks such as prop types.
      "@eslint-react/rules-of-hooks": "error",
      "@eslint-react/exhaustive-deps": "warn",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/dom-no-unknown-property": "error",
      "@eslint-react/dom-no-unsafe-target-blank": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml": "error",
    },
  },
  eslintConfigPrettier,
];
