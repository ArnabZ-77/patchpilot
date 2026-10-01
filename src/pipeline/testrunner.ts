import { spawn } from "node:child_process";
import type { RepoConfig, TestRun } from "../types.ts";

const MAX_SUMMARY_CHARS = 3500;
const MAX_FAILURES = 6;

/**
 * Run the repo's test command and return a bounded, filtered summary instead
 * of raw stdout (SWE-agent's windowing/5-observation-collapse principle
 * applied to test output: strip ANSI, keep failing test names + assertion
 * diffs, cap total size, report pass/fail counts).
 */
export async function runTests(repo: RepoConfig, cwd: string, extraArgs: string[] = [], timeoutMs = 120_000): Promise<TestRun> {
  const [cmd, ...args] = [...repo.testCommand, ...extraArgs];
  const started = Date.now();
  const { stdout, stderr, exitCode, timedOut } = await execCapture(cmd!, args, cwd, timeoutMs);
  const raw = stripAnsi(`${stdout}\n${stderr}`);
  const { passed, failed, failures } = parseJestLikeOutput(raw);
  const ok = exitCode === 0 && !timedOut;
  const summary = buildSummary(raw, passed, failed, timedOut, exitCode);
  return {
    command: [cmd, ...args].join(" "),
    passed,
    failed,
    durationMs: Date.now() - started,
    summary,
    failures: failures.slice(0, MAX_FAILURES),
    exitCode,
    ok,
  };
}

function execCapture(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32", env: { ...process.env, CI: "true", FORCE_COLOR: "0" } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), exitCode: -1, timedOut: false });
    });
  });
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Parses Jest/Vitest/Mocha-ish console output for counts and failing test blocks. Best-effort, framework-agnostic. */
export function parseJestLikeOutput(raw: string): { passed: number; failed: number; failures: Array<{ name: string; message: string }> } {
  let passed = 0;
  let failed = 0;

  const nodeTestPass = raw.match(/^#\s*pass\s+(\d+)/m);
  const nodeTestFail = raw.match(/^#\s*fail\s+(\d+)/m);
  const jestSummary = raw.match(/Tests?:\s*(?:(\d+)\s*failed,\s*)?(?:(\d+)\s*skipped,\s*)?(\d+)\s*passed,\s*(\d+)\s*total/i);

  if (nodeTestPass || nodeTestFail) {
    passed = Number(nodeTestPass?.[1] ?? 0);
    failed = Number(nodeTestFail?.[1] ?? 0);
  } else if (jestSummary) {
    failed = Number(jestSummary[1] ?? 0);
    passed = Number(jestSummary[3] ?? 0);
  } else {
    const passMatches = raw.match(/✓|√|PASS\b|passing\b/g);
    const failMatches = raw.match(/✗|✕|×|FAIL\b|failing\b|not ok \d/g);
    passed = passMatches?.length ?? 0;
    failed = failMatches?.length ?? 0;
  }

  const failures: Array<{ name: string; message: string }> = [];
  // Jest/Vitest-style "✕ test name" blocks.
  for (const b of raw.split(/\n(?=\s*(?:✕|✗|×)\s)/).slice(1)) {
    const nameLine = b.split("\n")[0]?.trim() ?? "unknown test";
    const body = b.split("\n").slice(1, 12).join("\n").trim();
    failures.push({ name: nameLine.replace(/^(✕|✗|×)\s*/, ""), message: body.slice(0, 600) });
  }
  // node:test TAP-style "not ok N - name" blocks, body indented until the next "ok"/"not ok"/"#".
  if (failures.length === 0) {
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^not ok \d+ - (.+)$/.exec(lines[i]!.trim());
      if (!m) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]!) && body.length < 12; j++) body.push(lines[j]!.trim());
      failures.push({ name: m[1]!, message: body.join("\n").slice(0, 600) });
    }
  }
  return { passed, failed, failures };
}

function buildSummary(raw: string, passed: number, failed: number, timedOut: boolean, exitCode: number | null): string {
  let head = `${passed} passed / ${failed} failed (exit ${exitCode}${timedOut ? ", TIMED OUT" : ""})\n\n`;
  const lines = raw.split("\n");
  const relevant = lines.filter((l) => /(fail|error|✕|✗|×|expect|assert|at .*\(.*:\d+:\d+\))/i.test(l) && !/node_modules/.test(l));
  let body = (relevant.length ? relevant : lines.slice(-80)).join("\n");
  if (head.length + body.length > MAX_SUMMARY_CHARS) body = body.slice(0, MAX_SUMMARY_CHARS - head.length) + "\n… (truncated)";
  return head + body;
}
