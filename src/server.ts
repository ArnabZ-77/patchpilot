import express from "express";
import path from "node:path";
import fs from "node:fs";
import { PORT, PROJECT_ROOT, loadConfig } from "./config.ts";
import { IncidentStore } from "./store.ts";
import { createIncident, recordOccurrence, manualEvent } from "./capture/incident.ts";
import { fingerprint } from "./capture/fingerprint.ts";
import { processIncident } from "./pipeline/orchestrator.ts";
import type { IncidentEvent } from "./types.ts";

const config = loadConfig();
const store = new IncidentStore();
const app = express();
app.use(express.json({ limit: "2mb" }));

const inFlight = new Set<string>();

function repoFor(name: string | undefined) {
  const key = name && config.repos[name] ? name : config.defaultRepo;
  const repo = config.repos[key];
  if (!repo) throw new Error(`No repo configured for "${key}". Check patchpilot.config.json.`);
  return { key, repo };
}

/** Webhook: the Express capture middleware posts Sentry-shaped crash events here. */
app.post("/api/incidents", (req, res) => {
  const ev = req.body as IncidentEvent;
  if (!ev?.exception?.values?.length) return res.status(400).json({ error: "invalid event: missing exception.values" });
  const repoName = ev.tags?.repo as string | undefined;
  let repoKey: string;
  let repo: ReturnType<typeof repoFor>["repo"];
  try {
    ({ key: repoKey, repo } = repoFor(repoName));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  const fp = fingerprint(ev);
  let inc = store.findByFingerprint(repoKey, fp);
  if (inc) {
    recordOccurrence(inc, ev);
    store.persist(inc);
    store.log(inc, "occurrence", `New occurrence of an existing incident (now ${inc.occurrences} total).`);
    return res.status(202).json({ incidentId: inc.id, status: "existing", stage: inc.stage });
  }
  inc = createIncident(ev, repoKey, repo.root);
  store.insert(inc);
  res.status(201).json({ incidentId: inc.id, status: "created" });
  runPipeline(inc, repo);
});

/** Non-crash bug reports: logic bugs that never throw in JS, filed as a description instead of a stack trace. */
app.post("/api/incidents/manual", (req, res) => {
  const { repo: repoName, title, description, suspectFile, environment } = req.body ?? {};
  if (!title || !description) return res.status(400).json({ error: "title and description are required" });
  let repoKey: string;
  let repo: ReturnType<typeof repoFor>["repo"];
  try {
    ({ key: repoKey, repo } = repoFor(repoName));
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  const ev = manualEvent({ title, description, environment, suspectFile });
  ev.tags = { ...ev.tags, repo: repoKey };
  const fp = fingerprint(ev);
  let inc = store.findByFingerprint(repoKey, fp);
  if (inc) {
    recordOccurrence(inc, ev);
    store.persist(inc);
    return res.status(202).json({ incidentId: inc.id, status: "existing", stage: inc.stage });
  }
  inc = createIncident(ev, repoKey, repo.root);
  store.insert(inc);
  res.status(201).json({ incidentId: inc.id, status: "created" });
  runPipeline(inc, repo);
});

function runPipeline(inc: ReturnType<typeof createIncident>, repo: ReturnType<typeof repoFor>["repo"]): void {
  if (inFlight.has(inc.id)) return;
  inFlight.add(inc.id);
  processIncident(inc, repo, config, store)
    .catch((err) => store.log(inc, "error", err instanceof Error ? err.message : String(err)))
    .finally(() => inFlight.delete(inc.id));
}

app.get("/api/incidents", (_req, res) => res.json(store.list()));
app.get("/api/incidents/:id", (req, res) => {
  const inc = store.get(req.params.id);
  if (!inc) return res.status(404).json({ error: "not found" });
  res.json(inc);
});
app.get("/api/config", (_req, res) => res.json({ repos: Object.keys(config.repos), defaultRepo: config.defaultRepo, maxFixAttempts: config.maxFixAttempts }));

/** Live timeline: Server-Sent Events fed by the IncidentStore's event bus (one subscription for all incidents; the dashboard filters client-side). */
app.get("/api/stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`event: ready\ndata: {}\n\n`);
  const onEvent = (busEvent: unknown) => res.write(`event: incident\ndata: ${JSON.stringify(busEvent)}\n\n`);
  store.on("event", onEvent);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    store.off("event", onEvent);
  });
});

const dashboardDir = path.join(PROJECT_ROOT, "dashboard");
if (fs.existsSync(dashboardDir)) app.use(express.static(dashboardDir));

app.listen(PORT, () => {
  console.log(`PatchPilot listening on http://localhost:${PORT}`);
  console.log(`Repos configured: ${Object.keys(config.repos).join(", ") || "(none — add one to patchpilot.config.json)"}`);
});
