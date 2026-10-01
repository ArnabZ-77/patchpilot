import fs from "node:fs";
import path from "node:path";
import type { Incident, ReproductionResult, RepoConfig, TriageResult } from "../types.ts";
import type { ModelSettings } from "../config.ts";
import { runAgent, registerMockHandler } from "../pipeline/model.ts";
import { makeReadFileTool, makeSearchTool, makeEditorTool } from "../pipeline/tools.ts";
import { makeBeforeTool, sha256 } from "../pipeline/guardrails.ts";
import { runTests } from "../pipeline/testrunner.ts";
import { extractJson } from "./util.ts";

const SYSTEM_PROMPT = `You are Reproducer, a test-first engineer. Your ONLY job is to write ONE new automated test that reproduces a reported bug.

Rules:
- You may create or edit files ONLY under the repository's test directories. You may never touch application source files.
- The test MUST fail on the current (unfixed) code with a clear assertion failure — not a thrown TypeError/import/setup error. If your test throws instead of asserting, that is "Other issues": fix the test, don't give up.
- The test MUST be meaningful: it should exercise the exact code path in the root cause, using the real exported functions/handlers, not a reimplementation of the bug.
- Use the project's existing test framework and conventions (look at a neighboring test file first).
- After writing the test, run it with run_test_file to confirm it currently FAILS for the right reason (an assertion, not a crash).
- Do not write multiple tests. One focused regression test.

When the test fails correctly, respond with ONLY a fenced JSON block:
\`\`\`json
{"test_file": "test/orders/total.regression.test.ts", "test_name": "computeTotal throws on undefined price", "failure_summary": "one line describing what currently fails"}
\`\`\``;

export async function runReproduce(
  inc: Incident,
  triage: TriageResult,
  repo: RepoConfig,
  settings: ModelSettings,
  cwd: string,
  onEvent?: (type: string, text?: string) => void,
): Promise<{ result: ReproductionResult; baseline: Awaited<ReturnType<typeof runTests>>; usage: any }> {
  const sampleTest = findSampleTest(cwd, repo);
  const prompt = `MOCK_TAG:reproduce
Write a regression test that reproduces this bug.

### Root cause (from Triage)
${triage.root_cause}
Intended behavior: ${triage.intended_behavior}

### Suspect location
${triage.suspects[0] ? `${triage.suspects[0].file}${triage.suspects[0].symbol ? ":" + triage.suspects[0].symbol : ""} (lines ${triage.suspects[0].startLine}-${triage.suspects[0].endLine})` : "see root cause"}

### Allowed test directories
${repo.testPaths.join(", ")}

${sampleTest ? `### Example of an existing test file for style/framework reference (${sampleTest.rel})\n${sampleTest.content}` : ""}

Write the test, run it with run_test_file, confirm it fails with an assertion (not a crash), then respond with the JSON block only.`;

  const beforeTool = makeBeforeTool({
    stage: "reproduce",
    repo,
    cwd,
    allowWritePaths: (rel) => repo.testPaths.some((p) => rel.startsWith(p)),
    onBlock: (b) => onEvent?.("guardrail-block", b.reason),
  });

  const runTestFileTool = {
    name: "run_test_file",
    description: "Run the project's test command restricted to one test file and return a bounded summary of pass/fail output.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async execute({ path: p }: { path: string }) {
      const run = await runTests(repo, testFileArgs(repo, p));
      return run.summary;
    },
  };

  const result = await runAgent(prompt, {
    settings,
    systemPrompt: SYSTEM_PROMPT,
    tools: [makeReadFileTool(cwd), makeSearchTool(cwd), makeEditorTool(cwd), runTestFileTool],
    maxIterations: 16,
    beforeTool,
    onEvent: (e) => {
      if (e.type === "tool-started") onEvent?.("tool", `${e.toolCall.toolName} ${JSON.stringify(e.toolCall.input).slice(0, 160)}`);
    },
  });

  const parsed = extractJson<{ test_file: string; test_name: string; failure_summary: string }>(result.outputText);
  if (!parsed?.test_file) throw new Error("Reproducer did not return a valid test_file.");

  const abs = path.join(cwd, parsed.test_file);
  if (!fs.existsSync(abs)) throw new Error(`Reproducer claimed to write "${parsed.test_file}" but it does not exist.`);

  // Verify independently: the test must fail on the unmodified tree (SWT-Bench F→P acceptance, checked server-side not just trusted from the agent).
  const baseline = await runTests(repo, testFileArgs(repo, parsed.test_file));
  if (baseline.ok || baseline.failed === 0) {
    throw new Error(`Reproduction test "${parsed.test_file}" does not fail on the current code (expected a failing assertion). Output: ${baseline.summary.slice(0, 300)}`);
  }

  const lockHash = sha256(fs.readFileSync(abs, "utf8"));
  const reproduction: ReproductionResult = { test_file: parsed.test_file, test_name: parsed.test_name ?? "regression test", failure_summary: parsed.failure_summary ?? baseline.summary.slice(0, 200), lockHash };
  return { result: reproduction, baseline, usage: result.usage };
}

function testFileArgs(repo: RepoConfig, relFile: string): string[] {
  // Works for Jest/Vitest's "pass a path" convention; projects with a different CLI should override testCommand accordingly.
  return [relFile];
}

function findSampleTest(cwd: string, repo: RepoConfig): { rel: string; content: string } | undefined {
  for (const dir of repo.testPaths) {
    const abs = path.join(cwd, dir);
    if (!fs.existsSync(abs)) continue;
    const files = fs.readdirSync(abs).filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
    if (files[0]) {
      const rel = path.join(dir, files[0]).replace(/\\/g, "/");
      return { rel, content: fs.readFileSync(path.join(abs, files[0]), "utf8").slice(0, 2000) };
    }
  }
  return undefined;
}

// --- deterministic mock ---
registerMockHandler({
  match: /MOCK_TAG:reproduce/,
  respond: async (prompt, opts) => {
    // The mock still performs a real file write + real test run so the pipeline's
    // independent verification step is genuinely exercised.
    const editor = opts.tools?.find((t) => t.name === "editor");
    const fileMatch = /### Allowed test directories\n([^\n]+)/.exec(prompt);
    const dir = fileMatch?.[1]?.split(",")[0]?.trim() ?? "test";
    const suspectMatch = /### Suspect location\n(\S+?)(?::(\S+))? \(lines (\d+)/.exec(prompt);
    const srcFile = suspectMatch?.[1] ?? "src/app.ts";
    const symbol = suspectMatch?.[2] ?? "handler";
    const testFile = `${dir}/patchpilot.regression.test.ts`;
    const testName = `${symbol} regression`;
    const importPath = "../" + srcFile.replace(/^src\//, "src/").replace(/\.ts$/, "");
    const body = `import { ${symbol} } from "${toImportSpecifier(importPath)}";\n\ntest("${testName}", () => {\n  expect(() => ${symbol}(undefined as any)).not.toThrow();\n});\n`;
    if (editor) await editor.execute({ path: testFile, new_text: body }, {} as any);
    return "```json\n" + JSON.stringify({ test_file: testFile, test_name: testName, failure_summary: `${symbol} throws instead of handling missing input` }) + "\n```";
  },
});

function toImportSpecifier(p: string): string {
  return p.startsWith(".") ? p : "./" + p;
}
