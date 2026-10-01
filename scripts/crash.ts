/**
 * Fires one (or all) of the demo app's planted bugs at a running
 * demo-app + PatchPilot pair, so you can watch the dashboard go from
 * "crash received" to "draft PR" live.
 *
 * Usage:
 *   npm run demo:crash            # fires all 10 bugs, 2s apart
 *   npm run demo:crash -- 01      # fires only bug "01-total"
 */
import { BUGS } from "../benchmark/golden/bugs.js";

const DEMO_URL = process.env.DEMO_URL || "http://localhost:5050";
const PATCHPILOT_URL = process.env.PATCHPILOT_URL || "http://localhost:4747";

async function fire(bug: (typeof BUGS)[number]): Promise<void> {
  if (bug.source === "crash") {
    const req = bug.request!;
    const url = new URL(req.path, DEMO_URL);
    if (req.query) for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method: req.method,
      headers: req.body ? { "content-type": "application/json" } : undefined,
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    console.log(`[${bug.id}] ${req.method} ${url.pathname} -> ${res.status} (expect 500; PatchPilot should receive a crash event)`);
  } else {
    const res = await fetch(new URL("/api/incidents/manual", PATCHPILOT_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "demo-app", title: bug.id, description: bug.description, suspectFile: bug.file }),
    });
    const json = await res.json();
    console.log(`[${bug.id}] manual report -> ${res.status} incident ${json.incidentId ?? "?"}`);
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const bugs = only ? BUGS.filter((b) => b.id.startsWith(only)) : BUGS;
  if (!bugs.length) {
    console.error(`No bug matches "${only}". Known ids: ${BUGS.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }
  for (const bug of bugs) {
    await fire(bug).catch((err) => console.error(`[${bug.id}] failed: ${err.message}`));
    if (bugs.length > 1) await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`\nOpen the dashboard to watch PatchPilot work: ${PATCHPILOT_URL}/`);
}

main();
