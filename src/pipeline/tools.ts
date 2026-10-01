import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "@cline/agents";

/**
 * A small, bounded toolset shared by all three agents — AutoCodeRover-style
 * structured search plus read/write/shell, each capped the way SWE-agent
 * bounds its windowed viewer and search output so a single tool call can
 * never flood the context.
 */
export function makeReadFileTool(cwd: string): AgentTool<{ path: string; start_line?: number; end_line?: number }, string> {
  return {
    name: "read_file",
    description: "Read a text file at a path relative to the repo root. Optionally give a 1-based inclusive start_line/end_line window. Returns at most 400 lines.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
      required: ["path"],
    },
    async execute({ path: relPath, start_line, end_line }: { path: string; start_line?: number; end_line?: number }) {
      const abs = safeResolve(cwd, relPath);
      const content = fs.readFileSync(abs, "utf8");
      const lines = content.split(/\r?\n/);
      const s = Math.max(1, start_line ?? 1);
      const e = Math.min(lines.length, end_line ?? Math.min(lines.length, s + 399));
      const windowed = lines.slice(s - 1, e).map((l, i) => `${s + i}:${l}`);
      const above = s > 1 ? `(${s - 1} more lines above)\n` : "";
      const below = e < lines.length ? `\n(${lines.length - e} more lines below)` : "";
      return `[File: ${relPath} (${lines.length} lines total)]\n${above}${windowed.join("\n")}${below}`;
    },
  };
}

export function makeSearchTool(cwd: string): AgentTool<{ queries: string[] }, string> {
  return {
    name: "search_codebase",
    description: "Regex search across the repo (excludes node_modules/.git). Up to 5 queries per call. Each query returns at most 50 matches; file content, not just names.",
    inputSchema: { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"] },
    async execute({ queries }: { queries: string[] }) {
      return queries
        .slice(0, 5)
        .map((q: string) => `### ${q}\n${searchOne(cwd, q)}`)
        .join("\n\n");
    },
  };
}

function searchOne(cwd: string, pattern: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return "invalid regex";
  }
  const hits: string[] = [];
  walk(cwd, (abs, rel) => {
    if (hits.length >= 50) return;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(rel)) return;
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (hits.length >= 50) return;
      if (re.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 200)}`);
    });
  });
  if (hits.length === 0) return `No matches for "${pattern}".`;
  const capped = hits.length >= 50;
  return hits.join("\n") + (capped ? "\n… (50+ matches, narrow your query)" : "");
}

function walk(dir: string, visit: (abs: string, rel: string) => void, root = dir): void {
  const skip = new Set(["node_modules", ".git", ".patchpilot", "coverage", "dist", "build"]);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, visit, root);
    else visit(abs, path.relative(root, abs).replace(/\\/g, "/"));
  }
}

export function makeEditorTool(cwd: string): AgentTool<{ path: string; old_text?: string | null; new_text: string; insert_line?: number | null }, string> {
  return {
    name: "editor",
    description:
      "Edit a file: creates it with new_text if missing. Otherwise provide old_text (must match exactly once) to replace it with new_text, OR insert_line to insert new_text at that line. Prefer small, exact edits.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: ["string", "null"] },
        new_text: { type: "string" },
        insert_line: { type: ["integer", "null"] },
      },
      required: ["path", "new_text"],
    },
    async execute({ path: relPath, old_text, new_text, insert_line }: { path: string; old_text?: string | null; new_text: string; insert_line?: number | null }) {
      const abs = safeResolve(cwd, relPath);
      if (!fs.existsSync(abs)) {
        if (old_text) throw new Error(`File "${relPath}" does not exist; omit old_text to create it.`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, new_text, "utf8");
        return `Created ${relPath} (${new_text.split("\n").length} lines).`;
      }
      const before = fs.readFileSync(abs, "utf8");
      let after: string;
      if (typeof insert_line === "number") {
        const lines = before.split(/\r?\n/);
        lines.splice(Math.max(0, Math.min(lines.length, insert_line)), 0, new_text);
        after = lines.join("\n");
      } else if (old_text) {
        const count = before.split(old_text).length - 1;
        if (count === 0) throw new Error(`old_text not found in ${relPath}. It must match exactly once — re-read the file and copy the exact text.`);
        if (count > 1) throw new Error(`old_text matches ${count} times in ${relPath}. Include more surrounding context so it matches exactly once.`);
        after = before.replace(old_text, new_text);
      } else {
        throw new Error("Provide either old_text (to replace) or insert_line (to insert).");
      }
      fs.writeFileSync(abs, after, "utf8");
      return `Updated ${relPath}. File updated. Please review the changes and make sure they are correct (correct indentation, no duplicate lines, etc).`;
    },
  };
}

function safeResolve(cwd: string, relPath: string): string {
  const target = path.resolve(cwd, relPath);
  const rel = path.relative(cwd, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error(`path "${relPath}" escapes the sandbox root`);
  return target;
}
