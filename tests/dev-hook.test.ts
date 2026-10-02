import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide } from "../.clinerules/hooks/PreToolUse.js";

const HOOK = fileURLToPath(new URL("../.clinerules/hooks/PreToolUse.js", import.meta.url));
const pre = (toolName: string, parameters: Record<string, unknown>) => ({ preToolUse: { toolName, parameters } });

describe("dev-Cline PreToolUse hook", () => {
  it("blocks writing a .env file", () => {
    expect(decide(pre("write_to_file", { path: ".env", content: "X=1" })).cancel).toBe(true);
    expect(decide(pre("replace_in_file", { path: "app/.env.local", diff: "..." })).cancel).toBe(true);
  });

  it("blocks changing the hidden benchmark tests", () => {
    expect(decide(pre("replace_in_file", { path: "benchmark/golden/01-total.test.js", diff: "..." })).cancel).toBe(true);
  });

  it("blocks deleting tests from the shell", () => {
    expect(decide(pre("execute_command", { command: "rm demo-app/tests/total.test.js" })).cancel).toBe(true);
    expect(decide(pre("execute_command", { command: "Remove-Item tests\\checkout.test.js" })).cancel).toBe(true);
  });

  it("blocks emptying a test file", () => {
    expect(decide(pre("write_to_file", { path: "tests/total.test.js", content: "   " })).cancel).toBe(true);
  });

  it("blocks destructive git commands", () => {
    expect(decide(pre("execute_command", { command: "git push --force origin main" })).cancel).toBe(true);
    expect(decide(pre("execute_command", { command: "git reset --hard HEAD~3" })).cancel).toBe(true);
  });

  it("allows normal work, including writing tests", () => {
    expect(decide(pre("write_to_file", { path: "tests/new.test.js", content: "test('x', () => {})" })).cancel).toBe(false);
    expect(decide(pre("replace_in_file", { path: "src/server.ts", diff: "..." })).cancel).toBe(false);
    expect(decide(pre("execute_command", { command: "npm test" })).cancel).toBe(false);
    expect(decide(pre("read_file", { path: ".env" })).cancel).toBe(false);
  });

  it("works as a real hook process: JSON on stdin, decision on stdout", () => {
    const run = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(pre("write_to_file", { path: ".env", content: "K=v" })), encoding: "utf8" });
    expect(JSON.parse(run.stdout).cancel).toBe(true);
    const ok = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(pre("execute_command", { command: "npm test" })), encoding: "utf8" });
    expect(JSON.parse(ok.stdout).cancel).toBe(false);
  });

  it("fails open on garbage input instead of freezing the agent", () => {
    const run = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(JSON.parse(run.stdout).cancel).toBe(false);
  });
});
