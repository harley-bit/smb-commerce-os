import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // `src/serve.ts` (D136) is excluded the same way `src/index.ts` already
      // was: a real `app.listen(...)` process entrypoint, not unit-testable
      // the way a route handler is — its correctness is what `e2e/` (a real
      // running server) proves, not `pnpm test`'s coverage gate.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/serve.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
