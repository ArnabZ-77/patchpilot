import { randomUUID } from "node:crypto";
import type { Incident, IncidentEvent } from "../types.ts";
import { fingerprint } from "./fingerprint.ts";
import { framesFromEvent } from "../agents/localize.ts";
import { emptyUsage } from "../pipeline/cost.ts";

/** Builds a manual (non-crash) incident event: a description instead of a stack trace, matching how a logic bug actually reaches a team. */
export function manualEvent(input: { title: string; description: string; environment?: string; suspectFile?: string }): IncidentEvent {
  return {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "warning",
    environment: input.environment ?? "production",
    exception: {
      values: [
        {
          type: "ReportedBug",
          value: input.description,
          mechanism: { type: "manual", handled: true },
          stacktrace: input.suspectFile ? { frames: [{ filename: input.suspectFile, in_app: true }] } : undefined,
        },
      ],
    },
    tags: { title: input.title },
  };
}

export function createIncident(ev: IncidentEvent, repo: string, repoDir: string): Incident {
  const fp = fingerprint(ev);
  const exc = ev.exception.values.at(-1);
  const id = `inc_${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  return {
    id,
    fingerprint: fp,
    repo,
    title: (ev.tags?.title as string) || `${exc?.type ?? "Error"}: ${(exc?.value ?? "").slice(0, 120)}`,
    exceptionType: exc?.type ?? "Error",
    exceptionValue: exc?.value ?? "",
    transaction: ev.transaction,
    environment: ev.environment,
    release: ev.release,
    events: [ev],
    occurrences: 1,
    firstSeen: now,
    lastSeen: now,
    stage: "received",
    stageHistory: [{ stage: "received", ts: now }],
    frames: framesFromEvent(ev, repoDir),
    attempts: [],
    guardrailBlocks: [],
    usage: emptyUsage(),
    timeline: [],
  };
}

export function recordOccurrence(inc: Incident, ev: IncidentEvent): void {
  inc.events.push(ev);
  if (inc.events.length > 20) inc.events.splice(0, inc.events.length - 20);
  inc.occurrences += 1;
  inc.lastSeen = new Date().toISOString();
}
