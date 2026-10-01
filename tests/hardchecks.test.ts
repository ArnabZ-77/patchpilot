import { describe, it, expect } from "vitest";
import { runHardChecks, allPass } from "../src/pipeline/hardchecks.ts";
import type { RepoConfig } from "../src/types.ts";

const repo: RepoConfig = {
  root: "/repo",
  subdir: "demo-app",
  testCommand: ["node", "--test"],
  testPaths: ["tests"],
  protectedPaths: ["server.js", "package.json"],
  maxDiffLines: 50,
  maxDiffFiles: 3,
};

describe("runHardChecks", () => {
  it("passes a small, clean source-only diff", () => {
    const diff = "--- a/src/lib/x.js\n+++ b/src/lib/x.js\n@@\n-old\n+new\n";
    const checks = runHardChecks(diff, ["src/lib/x.js"], repo);
    expect(allPass(checks)).toBe(true);
  });

  it("rejects a diff that touches a test file", () => {
    const checks = runHardChecks("+x", ["tests/x.test.js"], repo);
    expect(checks.find((c) => c.name === "no-test-file-edits")?.ok).toBe(false);
  });

  it("rejects a diff that touches a protected path", () => {
    const checks = runHardChecks("+x", ["server.js"], repo);
    expect(checks.find((c) => c.name === "no-protected-path-edits")?.ok).toBe(false);
  });

  it("rejects a diff over the file cap", () => {
    const checks = runHardChecks("+x", ["a.js", "b.js", "c.js", "d.js"], repo);
    expect(checks.find((c) => c.name === "diff-size-within-cap")?.ok).toBe(false);
  });

  it("flags a diff that skips a test", () => {
    const diff = "+it.skip('broken', () => {});\n";
    const checks = runHardChecks(diff, ["src/lib/x.js"], repo);
    expect(checks.find((c) => c.name === "no-skip-or-only-markers")?.ok).toBe(false);
  });

  it("flags a diff that mocks the module under test", () => {
    const diff = "+jest.mock('./x.js');\n";
    const checks = runHardChecks(diff, ["src/lib/x.js"], repo);
    expect(checks.find((c) => c.name === "no-new-module-mocks")?.ok).toBe(false);
  });

  it("flags an equality-override cheat", () => {
    const diff = "+class X { valueOf() { return true; } }\n";
    const checks = runHardChecks(diff, ["src/lib/x.js"], repo);
    expect(checks.find((c) => c.name === "no-equality-overrides")?.ok).toBe(false);
  });
});
