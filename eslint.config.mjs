import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import ts from "typescript-eslint";

export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/target/**",
      "**/generated/**",
      ".validation/**",
    ],
  },
  js.configs.recommended,
  ts.configs.recommended,
  {
    files: ["apps/desktop/src/**/*.tsx"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
);
