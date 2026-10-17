import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["node_modules/**", ".wrangler/**", "dist/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
);
