import { describe, it, expect } from "vitest";
import { parseJestLikeOutput, stripAnsi } from "../src/pipeline/testrunner.ts";

describe("parseJestLikeOutput", () => {
  it("parses node:test TAP summary lines", () => {
    const raw = "TAP version 13\nok 1 - foo\nnot ok 2 - bar\n  ---\n  error: expected 1 to equal 2\n  ...\n# tests 2\n# pass 1\n# fail 1\n";
    const { passed, failed, failures } = parseJestLikeOutput(raw);
    expect(passed).toBe(1);
    expect(failed).toBe(1);
    expect(failures[0]?.name).toBe("bar");
  });

  it("parses a Jest-style summary line", () => {
    const raw = "Tests:       1 failed, 2 passed, 3 total\n";
    const { passed, failed } = parseJestLikeOutput(raw);
    expect(passed).toBe(2);
    expect(failed).toBe(1);
  });
});

describe("stripAnsi", () => {
  it("removes color escape codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });
});
