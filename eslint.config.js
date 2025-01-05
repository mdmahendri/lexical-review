import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import eslintConfigPrettier from "eslint-config-prettier";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{ts,tsx}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/*.{ts,tsx}"],
    rules: {
      ...pluginReact.configs.flat.recommended,
      ...pluginReact.configs.flat["jsx-runtime"],
    },
  },
  eslintConfigPrettier,
];
