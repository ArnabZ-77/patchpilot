import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { INCIDENTS_DIR } from "./config.ts";
import type { Incident, Stage, TimelineEntry } from "./types.ts";

export interface BusEvent {
  incidentId: string;
  entry: TimelineEntry;
  /** Snapshot of volatile incident fields for dashboards. */
  incident: Pick<Incident, "id" | "stage" | "usage" | "guardrailBlocks" | "attempts" | "durationMs" | "title" | "repo" | "occurrences" | "pr" | "needsHumanReason">;
}

/**
 * In-memory incident store with JSON persistence and an event bus that the
 * SSE endpoint and the dashboard consume. One incident per fingerprint.
 */
export class IncidentStore extends EventEmitter {
  private incidents = new Map<string, Incident>();
  private byFingerprint = new Map<string, string>();

  constructor() {
    super();
    fs.mkdirSync(INCIDENTS_DIR, { recursive: true });
    for (const f of fs.readdirSync(INCIDENTS_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const inc = JSON.parse(fs.readFileSync(path.join(INCIDENTS_DIR, f), "utf8")) as Incident;
        // Runs interrupted by a restart cannot resume; mark them honestly.
        if (!["done", "needs_human", "failed"].includes(inc.stage)) {
          inc.stage = "failed";
          inc.error = "PatchPilot restarted while this incident was in flight.";
        }
        this.incidents.set(inc.id, inc);
        this.byFingerprint.set(`${inc.repo}:${inc.fingerprint}`, inc.id);
      } catch {
        /* skip corrupt file */
      }
    }
  }

  list(): Incident[] {
    return [...this.incidents.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  }

  get(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  findByFingerprint(repo: string, fingerprint: string): Incident | undefined {
    const id = this.byFingerprint.get(`${repo}:${fingerprint}`);
    return id ? this.incidents.get(id) : undefined;
  }

  insert(inc: Incident): void {
    this.incidents.set(inc.id, inc);
    this.byFingerprint.set(`${inc.repo}:${inc.fingerprint}`, inc.id);
    this.persist(inc);
    this.emit("created", inc);
  }

  log(inc: Incident, type: string, text?: string, data?: unknown): void {
    const entry: TimelineEntry = { ts: new Date().toISOString(), stage: inc.stage, type, text, data };
    inc.timeline.push(entry);
    if (inc.timeline.length > 2000) inc.timeline.splice(0, inc.timeline.length - 2000);
    this.emit("event", this.toBusEvent(inc, entry));
    if (type !== "text-delta") this.persist(inc);
  }

  setStage(inc: Incident, stage: Stage, note?: string): void {
    inc.stage = stage;
    inc.stageHistory.push({ stage, ts: new Date().toISOString() });
    this.log(inc, "stage", note ?? `→ ${stage}`);
  }

  persist(inc: Incident): void {
    const file = path.join(INCIDENTS_DIR, `${inc.id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(inc, null, 2));
    fs.renameSync(tmp, file);
  }

  toBusEvent(inc: Incident, entry: TimelineEntry): BusEvent {
    return {
      incidentId: inc.id,
      entry,
      incident: {
        id: inc.id,
        stage: inc.stage,
        usage: inc.usage,
        guardrailBlocks: inc.guardrailBlocks,
        attempts: inc.attempts,
        durationMs: inc.durationMs,
        title: inc.title,
        repo: inc.repo,
        occurrences: inc.occurrences,
        pr: inc.pr,
        needsHumanReason: inc.needsHumanReason,
      },
    };
  }
}
