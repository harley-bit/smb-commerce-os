import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several test files apply real migrations against the same shared
    // PostgreSQL database (DATABASE_URL) and reset its "drizzle" migration
    // tracking schema as part of that — running files in parallel workers
    // races on that shared state. Small package, cheap to run serially.
    fileParallelism: false,
  },
});
