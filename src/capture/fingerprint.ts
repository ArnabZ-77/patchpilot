import { createHash } from "node:crypto";
import type { IncidentEvent, StackFrame } from "../types.ts";

/**
 * Sentry-style grouping: explicit fingerprint first, else exception type +
 * the top in-app frames (module/basename/function/context line). Line and
 * column numbers are deliberately excluded so an unrelated edit above the
 * crash site does not create a new incident.
 */
export function fingerprint(ev: IncidentEvent): string {
  if (ev.fingerprint?.length) {
    return md5(ev.fingerprint.map((v) => (v === "{{ default }}" ? defaultFingerprint(ev) : v)));
  }
  return defaultFingerprint(ev);
}

function defaultFingerprint(ev: IncidentEvent): string {
  const exc = ev.exception.values.at(-1);
  if (!exc) return md5(["<no-exception>"]);
  const frames = exc.stacktrace?.frames ?? [];
  const inApp = frames.filter((f) => f.in_app);
  const use = (inApp.length ? inApp : frames).slice(-8);
  const parts: string[] = [exc.type ?? ""];
  if (use.length) {
    for (const f of use) parts.push(f.module ?? "", basename(f.filename ?? f.abs_path ?? "").toLowerCase(), f.function ?? "", (f.context_line ?? "").replace(/\s+/g, ""));
  } else {
    parts.push(normalizeValue(exc.value ?? ""));
  }
  return md5(parts);
}

export function normalizeValue(v: string): string {
  return v
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\d+/g, "<n>");
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function isInApp(f: StackFrame): boolean {
  if (typeof f.in_app === "boolean") return f.in_app;
  const p = f.abs_path ?? f.filename ?? "";
  return !/node_modules[\\/]/.test(p) && !p.startsWith("node:") && !/^internal[\\/]/.test(p);
}

const md5 = (xs: string[]) => createHash("md5").update(xs.join("\u0000")).digest("hex");
