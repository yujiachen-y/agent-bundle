import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spikes/**/*.test.{ts,js,mjs}", "spikes/**/__tests__/**/*.{ts,js,mjs}"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["spikes/**/src/lib/**/*.{ts,mjs}"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/results/**",
        "**/artifacts/**",
        "spikes/sandbox/docker/src/lib/sandbox.ts",
        "spikes/sandbox/e2b/src/lib/types.ts"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
