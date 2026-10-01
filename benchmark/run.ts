/**
 * The mini-benchmark: runs PatchPilot's full pipeline against all 10 planted
 * bugs and reports the metrics table from the research dossier. Each bug's
 * hidden golden test (never shown to any agent) is run against the
 * resulting sandbox independently, mirroring SWE-bench's FAIL_TO_PASS
 * grading.
 *
 * Usage: npm run bench            (uses PATCHPILOT_MOCK=1 unless an API key is set)
 */
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { loadConfig, PROJECT_ROOT } from "../src/config.ts";
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
}

async function syntheticEvent(bug: (typeof BUGS)[number]): Promise<IncidentEvent> {
  if (bug.source === "manual") {
    return manualEvent({ title: bug.id, description: bug.description!, suspectFile: bug.file });
  }
  // Crash bugs: actually invoke the buggy function in-process to capture a real stack trace,
  // exactly as the Express middleware would — no server needs to be running for the benchmark.
  const mod = await import(path.join(repo.root, repo.subdir ?? "", bug.file));
  try {
    callBuggy(bug.id, mod);
    throw new Error(`expected ${bug.id} to throw but it did not — bug may already be fixed in the working tree`);
  } catch (err) {
    const { buildEvent } = await import("../sdk/patchpilot-express.js");
    return buildEvent(err, undefined, { repo: "demo-app", root: path.join(repo.root, repo.subdir ?? "") });
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
  const inc = createIncident(ev, "demo-app", repo.root);
  store.insert(inc);

  await processIncident(inc, repo, config, store);

  let fixRateHit = false;
  if (inc.stage === "done" && inc.sandbox) {
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
  };
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
  if (!process.env.PATCHPILOT_MOCK && !process.env.ANTHROPIC_API_KEY && !process.env.PATCHPILOT_API_KEY) {
    console.log("No API key found — running in PATCHPILOT_MOCK=1 mode. Set ANTHROPIC_API_KEY to benchmark a real model.\n");
    process.env.PATCHPILOT_MOCK = "1";
  }

  const rows: Row[] = [];
  for (const bug of BUGS) {
    process.stdout.write(`Running ${bug.id} (${bug.category})... `);
    try {
      const row = await runOne(bug);
      rows.push(row);
      console.log(row.fixRateHit ? "FIXED" : row.stage === "needs_human" ? "ESCALATED" : "NOT FIXED");
    } catch (err) {
      console.log("ERROR:", (err as Error).message);
      rows.push({ id: bug.id, category: bug.category, stage: "failed", fixRateHit: false, reproducedFirst: false, timeToPrMs: undefined, costInr: 0, blocks: 0, escalated: false });
    }
  }

  printReport(rows);
}

function printReport(rows: Row[]): void {
  const fixed = rows.filter((r) => r.fixRateHit).length;
  const reproduced = rows.filter((r) => r.reproducedFirst).length;
  const escalated = rows.filter((r) => r.escalated).length;
  const totalCost = rows.reduce((s, r) => s + r.costInr, 0);
  const times = rows.map((r) => r.timeToPrMs).filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  const medianMs = times.length ? times[Math.floor(times.length / 2)]! : 0;
  const totalBlocks = rows.reduce((s, r) => s + r.blocks, 0);

  console.log("\n--- PatchPilot mini-benchmark ---\n");
  console.log(`${"id".padEnd(14)}${"category".padEnd(26)}${"stage".padEnd(14)}${"fixed".padEnd(8)}₹cost`);
  for (const r of rows) {
    console.log(`${r.id.padEnd(14)}${r.category.padEnd(26)}${r.stage.padEnd(14)}${(r.fixRateHit ? "yes" : "no").padEnd(8)}₹${r.costInr.toFixed(2)}`);
  }
  console.log("\nSummary:");
  console.log(`  Fix rate:              ${fixed}/${rows.length}  (target: 8/10 or better)`);
  console.log(`  Reproduction rate:     ${reproduced}/${rows.length}  (Reproducer wrote a test that failed before the fix)`);
  console.log(`  Escalation count:      ${escalated}/${rows.length}  (no intentionally-unfixable bugs in this set — see README)`);
  console.log(`  Median time to PR:     ${(medianMs / 1000).toFixed(1)}s  (target: under 3 min median)`);
  console.log(`  Total cost:            ₹${totalCost.toFixed(2)}  (₹${(totalCost / rows.length).toFixed(2)} avg/fix, target: under ₹20/fix)`);
  console.log(`  Unsafe actions blocked: ${totalBlocks}`);

  const outFile = path.join(PROJECT_ROOT, ".patchpilot", "benchmark-report.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ rows, fixed, reproduced, escalated, medianMs, totalCost, totalBlocks, ranAt: new Date().toISOString() }, null, 2));
  console.log(`\nFull report written to ${path.relative(PROJECT_ROOT, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
