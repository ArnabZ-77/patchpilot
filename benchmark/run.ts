/**
 * The mini-benchmark: runs PatchPilot's full pipeline against all 10 planted
 * bugs and reports the metrics table from the research dossier. Each bug's
 * hidden golden test (never shown to any agent) is run against the
 * resulting sandbox independently, mirroring SWE-bench's FAIL_TO_PASS
 * grading.
 *
 * Usage: npm run bench            (real model from .env; set PATCHPILOT_MOCK=1 for zero-cost fixtures)
 */
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadConfig, PROJECT_ROOT, resolveModelSettings } from "../src/config.ts";
import { IncidentStore } from "../src/store.ts";
import { createIncident, manualEvent } from "../src/capture/incident.ts";
import { processIncident } from "../src/pipeline/orchestrator.ts";
import { BUGS } from "./golden/bugs.js";
import type { IncidentEvent } from "../src/types.ts";

const config = loadConfig();
const repo = config.repos["demo-app"];
if (!repo) throw new Error('patchpilot.config.json has no "demo-app" repo configured.');

interface Row {
  id: string;
  category: string;
  stage: string;
  fixRateHit: boolean;
  reproducedFirst: boolean;
  timeToPrMs: number | undefined;
  costInr: number;
  blocks: number;
  escalated: boolean;
  /** True for bugs that are unfixable as stated; the correct outcome is Needs Human. */
  expectEscalate: boolean;
}

async function syntheticEvent(bug: (typeof BUGS)[number]): Promise<IncidentEvent> {
  if (bug.source === "manual") {
    return manualEvent({ title: bug.id, description: bug.description!, suspectFile: bug.file });
  }
  // Crash bugs: actually invoke the buggy function in-process to capture a real stack trace,
  // exactly as the Express middleware would — no server needs to be running for the benchmark.
  const appRoot = path.join(repo.root, repo.subdir ?? "");
  const mod = await import(pathToFileURL(path.join(appRoot, bug.file)).href);
  try {
    callBuggy(bug.id, mod);
    throw new Error(`expected ${bug.id} to throw but it did not — bug may already be fixed in the working tree`);
  } catch (err) {
    const { buildEvent } = await import(pathToFileURL(path.join(PROJECT_ROOT, "sdk", "patchpilot-express.js")).href);
    return buildEvent(err, undefined, { repo: "demo-app", root: appRoot }) as unknown as IncidentEvent;
  }
}

function callBuggy(id: string, mod: Record<string, any>): void {
  if (id === "01-total") mod.computeTotal([{ price: 1, quantity: 1 }, null]);
  else if (id === "02-profile") mod.getUserCity({ name: "x" });
  else if (id === "04-refund") mod.calculateRefund("$19.99", "0");
  else throw new Error(`no in-process trigger registered for crash bug ${id}`);
}

async function runOne(bug: (typeof BUGS)[number]): Promise<Row> {
  const store = new IncidentStore();
  const ev = await syntheticEvent(bug);
  ev.tags = { ...ev.tags, repo: "demo-app" };
  const inc = createIncident(ev, "demo-app", path.join(repo.root, repo.subdir ?? ""));
  store.insert(inc);

  await processIncident(inc, repo, config, store);

  let fixRateHit = false;
  if (inc.stage === "done" && inc.sandbox && bug.golden) {
    fixRateHit = await runGoldenTest(inc.sandbox.cwd, bug.golden);
  }

  return {
    id: bug.id,
    category: bug.category,
    stage: inc.stage,
    fixRateHit,
    reproducedFirst: !!inc.reproduction,
    timeToPrMs: inc.durationMs,
    costInr: inc.usage.inr,
    blocks: inc.guardrailBlocks.length,
    escalated: inc.stage === "needs_human",
    expectEscalate: bug.expect === "needs_human",
  };
}

function verdict(r: Row): string {
  if (r.expectEscalate) return r.escalated ? "ESCALATED (correct)" : r.stage === "done" ? "WRONG: made a PR for a contradictory request" : "NOT ESCALATED";
  return r.fixRateHit ? "FIXED" : r.escalated ? "ESCALATED" : "NOT FIXED";
}

async function runGoldenTest(sandboxCwd: string, goldenFile: string): Promise<boolean> {
  const destDir = path.join(sandboxCwd, "tests", "__golden__");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(PROJECT_ROOT, "benchmark", "golden", goldenFile), path.join(destDir, goldenFile));
  const result = await new Promise<boolean>((resolve) => {
    const child = spawn("node", ["--test", `tests/__golden__/${goldenFile}`], { cwd: sandboxCwd, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve(code === 0));
  });
  return result;
}

async function main(): Promise<void> {
  if (process.env.PATCHPILOT_MOCK !== "1") {
    const s = resolveModelSettings();
    if (!s.apiKey || /paste-your|sk-ant-\.\.\./.test(s.apiKey)) {
      console.error(`No API key found for provider "${s.providerId}". Put your key in .env (see .env.example), or run with PATCHPILOT_MOCK=1.`);
      process.exit(1);
    }
    console.log(`Running against a real model: ${s.providerId} / ${s.modelId}\n`);
  }

  // Optional filter: `npm run bench -- 01` runs only bugs whose id starts with "01".
  const only = process.argv[2];
  const bugs = only ? BUGS.filter((b: { id: string }) => b.id.startsWith(only)) : BUGS;
  if (!bugs.length) {
    console.error(`No bug id starts with "${only}".`);
    process.exit(1);
  }

  const rows: Row[] = [];
  for (const bug of bugs) {
    process.stdout.write(`Running ${bug.id} (${bug.category})... `);
    try {
      const row = await runOne(bug);
      rows.push(row);
      console.log(verdict(row));
    } catch (err) {
      console.log("ERROR:", (err as Error).message);
      rows.push({ id: bug.id, category: bug.category, stage: "failed", fixRateHit: false, reproducedFirst: false, timeToPrMs: undefined, costInr: 0, blocks: 0, escalated: false, expectEscalate: bug.expect === "needs_human" });
    }
  }

  printReport(rows);
}

function printReport(rows: Row[]): void {
  const fixable = rows.filter((r) => !r.expectEscalate);
  const conflicting = rows.filter((r) => r.expectEscalate);
  const fixed = fixable.filter((r) => r.fixRateHit).length;
  const reproduced = fixable.filter((r) => r.reproducedFirst).length;
  const correctEscalations = conflicting.filter((r) => r.escalated).length;
  const wrongEscalations = fixable.filter((r) => r.escalated).length;
  const totalCost = rows.reduce((s, r) => s + r.costInr, 0);
  const times = fixable.filter((r) => r.fixRateHit).map((r) => r.timeToPrMs).filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  const medianMs = times.length ? times[Math.floor(times.length / 2)]! : 0;
  const totalBlocks = rows.reduce((s, r) => s + r.blocks, 0);

  console.log("\n--- PatchPilot mini-benchmark ---\n");
  console.log(`${"id".padEnd(14)}${"stage".padEnd(13)}${"blocks".padEnd(8)}${"₹cost".padEnd(9)}result`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(14)}${r.stage.padEnd(13)}${String(r.blocks).padEnd(8)}${("₹" + r.costInr.toFixed(2)).padEnd(9)}${verdict(r)}`);
  }
  console.log("\nSummary:");
  if (fixable.length) {
    console.log(`  Fix rate:               ${fixed}/${fixable.length}  (graded by hidden tests; target 8/10)`);
    console.log(`  Reproduction rate:      ${reproduced}/${fixable.length}  (Reproducer's test failed before the fix)`);
    console.log(`  Median time to PR:      ${(medianMs / 1000).toFixed(1)}s  (fixed bugs only; target under 3 min)`);
    console.log(`  Wrongly escalated:      ${wrongEscalations}/${fixable.length}  (fixable bugs handed to a human)`);
  }
  if (conflicting.length) {
    console.log(`  Escalation honesty:     ${correctEscalations}/${conflicting.length}  (contradictory requests correctly sent to Needs Human)`);
  }
  console.log(`  Unsafe actions blocked: ${totalBlocks}`);
  console.log(`  Total cost:             ₹${totalCost.toFixed(2)}  (₹${(totalCost / Math.max(1, rows.length)).toFixed(2)} per bug; target under ₹20)`);

  const outFile = path.join(PROJECT_ROOT, ".patchpilot", "benchmark-report.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ rows, fixed, fixable: fixable.length, reproduced, correctEscalations, wrongEscalations, medianMs, totalCost, totalBlocks, ranAt: new Date().toISOString() }, null, 2));
  console.log(`\nFull report written to ${path.relative(PROJECT_ROOT, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
