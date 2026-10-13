import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/** `text-[9px]`, `!text-[8.5px]`, `text-[9.25px]` … – anything under the 9.5-px floor (an esquery regex). */
const TINY_TEXT = String.raw`/text-\[(?:[0-8](?:\.[0-9]+)?|9(?:\.[0-4][0-9]*)?)px\]/`;
const TINY_TEXT_MESSAGE = "Schrift unter 9,5 px (DESIGN.md: kleinste Schrift 9,5 px) – text-[9.5px] oder größer.";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  { files: ["src/ui/**/*.tsx"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  {
    // DESIGN.md „Kleinste Schrift: 9,5 px – nichts darunter“ (P2-11): no Tailwind text size below 9.5 px in class strings
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${TINY_TEXT}]`, message: TINY_TEXT_MESSAGE },
        { selector: `TemplateElement[value.raw=${TINY_TEXT}]`, message: TINY_TEXT_MESSAGE },
      ],
    },
  },
);
