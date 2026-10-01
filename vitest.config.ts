import { defineConfig } from "vitest/config";

// PatchPilot's own unit tests live under tests/ and run on vitest.
// demo-app/tests and benchmark/golden are node:test suites for the target
// application and the hidden benchmark, not for this project — excluded so
// `npm test` doesn't try to run them as vitest specs.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "demo-app/**", "benchmark/**", ".patchpilot/**"],
  },
});
