import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const MAX_FILE_LINES = 320;
const MAX_FUNCTION_LINES = 90;
const MAX_COMPLEXITY = 20;

const commonRules = {
  "max-lines": [
    "error",
    {
      max: MAX_FILE_LINES,
      skipBlankLines: true,
      skipComments: true,
    },
  ],
  "max-lines-per-function": [
    "error",
    {
      max: MAX_FUNCTION_LINES,
      skipBlankLines: true,
      skipComments: true,
      IIFEs: true,
    },
  ],
  complexity: ["error", MAX_COMPLEXITY],
  "no-console": "off",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/results/**",
      "**/artifacts/**",
      "**/coverage/**",
      "**/*.d.ts",
      "src/webui/public/**",
    ],
  },
  {
    files: ["spikes/**/*.{js,mjs,cjs}", "src/**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...commonRules,
    },
  },
  {
    files: ["spikes/**/*.{ts,mts,cts,tsx}", "src/**/*.{ts,mts,cts,tsx}"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...commonRules,
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
