import fs from "node:fs";
import path from "node:path";
import type { Incident, IncidentEvent, Suspect } from "../types.ts";
import { isInApp } from "../capture/fingerprint.ts";

/**
 * Stack-trace seeded fault localization (the "external analysis tool" block
 * AutoCodeRover feeds its agent). Frames closest to the throw rank highest;
 * frames outside the repo or in node_modules are dropped.
 */
export function framesFromEvent(ev: IncidentEvent, repoDir: string): Incident["frames"] {
  const exc = ev.exception.values.at(-1);
  const frames = exc?.stacktrace?.frames ?? [];
  const out: Incident["frames"] = [];
  for (const f of frames) {
    const abs = f.abs_path ?? f.filename ?? "";
    const rel = toRepoRelative(abs, f.filename, repoDir);
    if (!rel) continue;
    out.push({ file: rel, line: f.lineno, column: f.colno, function: f.function, inApp: isInApp(f) });
  }
  return out;
}

export function toRepoRelative(absOrRel: string, filename: string | undefined, repoDir: string): string | undefined {
  const candidates = [absOrRel, filename].filter((x): x is string => !!x);
  for (let c of candidates) {
    c = c.replace(/^file:\/\/\/?/, "");
    const norm = c.replace(/\\/g, "/");
    const root = repoDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm.toLowerCase().startsWith(root.toLowerCase() + "/")) return norm.slice(root.length + 1);
    if (!path.isAbsolute(c) && !norm.startsWith("node:")) return norm.replace(/^\.\//, "");
  }
  return undefined;
}

/** Rank suspect functions from the stack trace: score = 1/(1+depth) over in-app frames, reversed so the throw site is depth 0. */
export function rankSuspectsFromFrames(frames: Incident["frames"], cwd: string): Suspect[] {
  const inApp = frames.filter((f) => f.inApp && !isTestPath(f.file));
  const suspects: Suspect[] = [];
  const seen = new Set<string>();
  const reversed = [...inApp].reverse(); // last frame raised the exception
  reversed.forEach((f, depth) => {
    const key = `${f.file}:${f.function ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const range = f.line ? enclosingRange(path.join(cwd, f.file), f.line) : undefined;
    suspects.push({
      file: f.file,
      symbol: f.function,
      startLine: range?.start ?? f.line,
      endLine: range?.end ?? f.line,
      score: Number((1 / (1 + depth)).toFixed(3)),
      evidence: ["stack_frame"],
      reason: depth === 0 ? "frame that raised the exception" : `${depth} frame${depth > 1 ? "s" : ""} above the throw site`,
    });
  });
  return suspects;
}

export function isTestPath(file: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/** Cheap brace-balanced enclosing function range for JS/TS. Falls back to ±15 lines. */
export function enclosingRange(absFile: string, line: number): { start: number; end: number } | undefined {
  let src: string;
  try {
    src = fs.readFileSync(absFile, "utf8");
  } catch {
    return undefined;
  }
  const lines = src.split(/\r?\n/);
  if (line < 1 || line > lines.length) return undefined;
  const fnHead = /^\s*(export\s+)?(async\s+)?(function\b|const\s+\w+\s*=\s*(async\s*)?\(|[\w$]+\s*\([^)]*\)\s*\{|\w+\s*:\s*(async\s*)?\(|class\b)/;
  let start = line;
  for (let i = line - 1; i >= 0; i--) {
    if (fnHead.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  let depth = 0;
  let end = Math.min(lines.length, line + 15);
  let opened = false;
  for (let i = start - 1; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") depth--;
    }
    if (opened && depth <= 0) {
      end = i + 1;
      break;
    }
  }
  return { start: Math.max(1, start), end: Math.max(end, line) };
}

/** Compact repository tree (Agentless shows the full structure; we bound it). */
export function repoTree(cwd: string, maxEntries = 400): string {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", ".patchpilot", "coverage", "dist", "build"]);
  const walk = (dir: string, prefix: string) => {
    if (out.length >= maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      if (out.length >= maxEntries) {
        out.push(`${prefix}… (truncated)`);
        return;
      }
      if (e.isDirectory()) {
        out.push(`${prefix}${e.name}/`);
        walk(path.join(dir, e.name), prefix + "  ");
      } else out.push(`${prefix}${e.name}`);
    }
  };
  walk(cwd, "");
  return out.join("\n");
}
