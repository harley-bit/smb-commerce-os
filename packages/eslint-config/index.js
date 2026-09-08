import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

import noRawSql from "./rules/no-raw-sql.js";

const localPlugin = { rules: { "no-raw-sql": noRawSql } };

/**
 * Shared flat ESLint config for all @smb-os packages.
 *
 * `allowRawSql` is only ever true for packages/db — that's the one place
 * allowed to talk to the dialect directly, and it's responsible for
 * enforcing tenant scoping on every query it builds. See `no-raw-sql.js`.
 */
export function createConfig({ allowRawSql = false } = {}) {
  return [
    {
      ignores: ["dist/**", "**/*.tsbuildinfo", ".turbo/**", "coverage/**"],
    },
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          sourceType: "module",
        },
      },
      plugins: {
        "@typescript-eslint": tsPlugin,
        local: localPlugin,
      },
      rules: {
        ...tsPlugin.configs.recommended.rules,
        "local/no-raw-sql": allowRawSql ? "off" : "error",
      },
    },
    prettierConfig,
  ];
}

export default createConfig;
