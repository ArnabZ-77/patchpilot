import fs from "node:fs";
import path from "node:path";
import type { HardCheckResult, RepoConfig } from "../types.ts";
import { globMatch } from "./guardrails.ts";
import { isTestPath } from "../agents/localize.ts";

/**
 * Diff-shape checks that run after a Fixer attempt, independent of the
 * PreToolUse hook (belt-and-braces: catches edits made via a tool the hook
 * didn't recognize, and the ImpossibleBench cheating taxonomy — skipped
 * tests, mocked-out modules under test, overridden equality operators).
 */
export function runHardChecks(diff: string, files: string[], repo: RepoConfig): HardCheckResult[] {
  const checks: HardCheckResult[] = [];

  const touchedTests = files.filter((f) => isTestPath(f) || repo.testPaths.some((p) => f.startsWith(p)));
  checks.push({ name: "no-test-file-edits", ok: touchedTests.length === 0, detail: touchedTests.length ? `touched: ${touchedTests.join(", ")}` : undefined });

  const touchedProtected = files.filter((f) => repo.protectedPaths.some((p) => globMatch(f, p)));
  checks.push({ name: "no-protected-path-edits", ok: touchedProtected.length === 0, detail: touchedProtected.length ? touchedProtected.join(", ") : undefined });

  checks.push({ name: "diff-size-within-cap", ok: files.length <= (repo.maxDiffFiles ?? 5), detail: `${files.length} files (cap ${repo.maxDiffFiles ?? 5})` });

  const changedLines = diff.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).length;
  checks.push({ name: "diff-lines-within-cap", ok: changedLines <= (repo.maxDiffLines ?? 200), detail: `${changedLines} lines (cap ${repo.maxDiffLines ?? 200})` });

  const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const addedText = addedLines.join("\n");

  const skipPattern = /\.(skip|only)\s*\(|xit\s*\(|xdescribe\s*\(|\btest\.todo\s*\(/;
  checks.push({ name: "no-skip-or-only-markers", ok: !skipPattern.test(addedText), detail: skipPattern.test(addedText) ? "diff adds .skip/.only/xit/xdescribe" : undefined });

  const mockPattern = /jest\.mock\s*\(|vi\.mock\s*\(/;
  checks.push({ name: "no-new-module-mocks", ok: !mockPattern.test(addedText), detail: mockPattern.test(addedText) ? "diff adds jest.mock/vi.mock — review whether it masks the bug instead of fixing it" : undefined });

  const equalityOverridePattern = /\b(valueOf|toJSON|Symbol\.toPrimitive|\[Symbol\.equals\])\s*\(/;
  checks.push({
    name: "no-equality-overrides",
    ok: !equalityOverridePattern.test(addedText),
    detail: equalityOverridePattern.test(addedText) ? "diff defines valueOf/toJSON/Symbol.toPrimitive — possible comparison-overload cheat (ImpossibleBench taxonomy)" : undefined,
  });

  checks.push({ name: "diff-not-empty", ok: diff.trim().length > 0 });

  return checks;
}

export function allPass(checks: HardCheckResult[]): boolean {
  return checks.every((c) => c.ok);
}

/** Confirms source for every file referenced in a diff still parses as plausible JS/TS (brace balance), catching truncated/garbled patches cheaply before running the suite. */
export function braceBalanceOk(cwd: string, files: string[]): HardCheckResult {
  for (const f of files) {
    const abs = path.join(cwd, f);
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) || !fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    let depth = 0;
    for (const ch of src) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth < 0) return { name: "brace-balance", ok: false, detail: `${f} has an unmatched closing brace` };
    }
    if (depth !== 0) return { name: "brace-balance", ok: false, detail: `${f} has ${depth} unmatched opening brace(s)` };
  }
  return { name: "brace-balance", ok: true };
}
