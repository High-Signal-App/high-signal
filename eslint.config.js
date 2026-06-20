// Plain flat ESLint config (formerly @saas-maker/eslint-config/next, inlined;
// no remote-standards fetch, no fallow plugin).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/build/**",
      "**/.wrangler/**",
      "**/node_modules/**",
      "**/out/**",
      "**/.open-next/**",
      "python/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  { settings: { react: { version: "19.0.0" } } },
  prettier,
];
