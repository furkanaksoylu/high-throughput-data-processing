import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      RUN_INTEGRATION_TESTS: "1",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
