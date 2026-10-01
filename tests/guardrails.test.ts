import { describe, it, expect } from "vitest";
import { makeBeforeTool, globMatch } from "../src/pipeline/guardrails.ts";
import type { RepoConfig } from "../src/types.ts";

const repo: RepoConfig = {
  root: "/repo",
  subdir: "demo-app",
  testCommand: ["node", "--test"],
  testPaths: ["tests"],
  protectedPaths: ["server.js", "package.json", ".env.*"],
  maxDiffLines: 50,
  maxDiffFiles: 3,
};

function call(toolName: string, input: unknown) {
  return { tool: { name: toolName } as any, toolCall: { toolName } as any, input };
}

describe("globMatch", () => {
  it("matches a literal path", () => expect(globMatch("server.js", "server.js")).toBe(true));
  it("matches a single-segment wildcard", () => expect(globMatch(".env.local", ".env.*")).toBe(true));
  it("does not cross segments with a single star", () => expect(globMatch("a/b.js", "*.js")).toBe(false));
  it("matches across segments with **", () => expect(globMatch("a/b/c.test.js", "**/*.test.js")).toBe(true));
});

describe("makeBeforeTool", () => {
  it("blocks the Fixer from editing a test file", () => {
    const blocks: string[] = [];
    const beforeTool = makeBeforeTool({ stage: "fix", repo, cwd: "/sandbox/demo-app", onBlock: (b) => blocks.push(b.reason) });
    const result = beforeTool(call("editor", { path: "tests/foo.test.js", new_text: "x" }));
    expect(result?.skip).toBe(true);
    expect(blocks).toHaveLength(1);
  });

  it("blocks writes to a protected path in any stage", () => {
    const blocks: string[] = [];
    const beforeTool = makeBeforeTool({ stage: "fix", repo, cwd: "/sandbox/demo-app", onBlock: (b) => blocks.push(b.reason) });
    const result = beforeTool(call("editor", { path: "server.js", new_text: "x" }));
    expect(result?.skip).toBe(true);
  });

  it("blocks the Triage agent from writing anything", () => {
    const beforeTool = makeBeforeTool({ stage: "triage", repo, cwd: "/sandbox/demo-app", onBlock: () => {} });
    const result = beforeTool(call("editor", { path: "src/lib/x.js", new_text: "x" }));
    expect(result?.skip).toBe(true);
  });

  it("allows the Fixer to edit source files", () => {
    const beforeTool = makeBeforeTool({ stage: "fix", repo, cwd: "/sandbox/demo-app", onBlock: () => {} });
    const result = beforeTool(call("editor", { path: "src/lib/x.js", new_text: "x" }));
    expect(result).toBeUndefined();
  });

  it("blocks the Fixer from touching the locked reproduction test even after acceptance", () => {
    const beforeTool = makeBeforeTool({
      stage: "fix",
      repo,
      cwd: "/sandbox/demo-app",
      lockedFiles: new Map([["tests/foo.test.js", "deadbeef"]]),
      onBlock: () => {},
    });
    const result = beforeTool(call("editor", { path: "tests/foo.test.js", new_text: "x" }));
    expect(result?.skip).toBe(true);
  });

  it("blocks a destructive shell command", () => {
    const beforeTool = makeBeforeTool({ stage: "fix", repo, cwd: "/sandbox/demo-app", onBlock: () => {} });
    const result = beforeTool(call("run_commands", { commands: ["git push origin main --force"] }));
    expect(result?.skip).toBe(true);
  });

  it("allows an ordinary test command", () => {
    const beforeTool = makeBeforeTool({ stage: "fix", repo, cwd: "/sandbox/demo-app", onBlock: () => {} });
    const result = beforeTool(call("run_commands", { commands: ["node --test"] }));
    expect(result).toBeUndefined();
  });
});
