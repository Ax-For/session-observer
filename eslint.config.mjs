import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", ".codegraph/", "coverage/"],
  },
  // Root-level server entry and server module files
  {
    files: ["server.js", "server/**/*.js", "tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2022,
      sourceType: "commonjs",
    },
  },
  // Shared parsing modules (UMD, lenient)
  {
    files: ["shared/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      ecmaVersion: 2022,
      sourceType: "commonjs",
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
  // Browser JS files (src/) — ES modules with browser globals
  {
    files: ["src/**/*.js"],
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  // React JSX files
  {
    files: ["**/*.jsx"],
    ...reactPlugin.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-vars": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // Test files — relaxed unused vars
  {
    files: ["**/*.test.{js,jsx,mjs}", "**/__tests__/**/*.{js,jsx}", "src/test/setup.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
  // Build/config files
  {
    files: ["vite.config.mjs", "eslint.config.mjs"],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
];
