import path from "node:path";
import { createHash } from "node:crypto";
import type { RepoConfig, Stage, GuardrailBlock } from "../types.ts";
import { isTestPath } from "../agents/localize.ts";

/**
 * Hard guardrails enforced from a Cline `beforeTool` hook — not a prompt
 * instruction. Every write/shell tool call is checked before it runs;
 * blocked calls never touch disk. This is the PreToolUse layer the research
 * dossier calls for (ImpossibleBench: prompt wording alone is not enough).
 */
export interface GuardrailContext {
  stage: Stage;
  repo: RepoConfig;
  cwd: string;
  /** Paths the current agent is allowed to write (in addition to global protections). stage-specific. */
  allowWritePaths?: (relPath: string) => boolean;
  /** Set once the Reproducer's test is accepted; the Fixer must not change its bytes. */
  lockedFiles?: Map<string, string>;
  onBlock: (block: GuardrailBlock) => void;
}

const DANGEROUS_COMMAND = /\b(rm\s+-rf|git\s+push|git\s+reset\s+--hard|git\s+checkout\s+--\s|curl\s|wget\s|npm\s+publish|:\s*>\s*|shutdown|format\s+[a-z]:)\b/i;

export function makeBeforeTool(ctx: GuardrailContext) {
  return (input: { tool: { name: string }; toolCall: { toolName: string }; input: unknown }) => {
    const toolName = input.tool?.name ?? input.toolCall?.toolName;
    const args = (input.input ?? {}) as Record<string, unknown>;

    const writeTargets = extractWriteTargets(toolName, args);
    for (const rel of writeTargets) {
      const reason = checkWritePath(rel, ctx);
      if (reason) return block(ctx, toolName, args, reason);
    }

    if (toolName === "run_commands" || toolName === "bash") {
      const commands = extractCommands(args);
      for (const cmd of commands) {
        if (DANGEROUS_COMMAND.test(cmd)) return block(ctx, toolName, args, `GUARDRAIL: command looks destructive or network-/VCS-mutating and is blocked in sandboxed runs: "${cmd.slice(0, 120)}"`);
      }
    }
    return undefined;
  };
}

function checkWritePath(relPathRaw: string, ctx: GuardrailContext): string | undefined {
  const rel = normalize(relPathRaw);
  const protectedHit = ctx.repo.protectedPaths.find((p) => globMatch(rel, p));
  if (protectedHit) return `GUARDRAIL: "${rel}" matches a protected path (${protectedHit}) and cannot be edited by an agent.`;

  const isTest = isTestPath(rel) || ctx.repo.testPaths.some((p) => rel.startsWith(p));
  if (ctx.stage === "fix" && isTest) return `GUARDRAIL: the Fixer agent may not modify test files ("${rel}"). Fix the source, not the test.`;
  if (ctx.stage === "triage") return `GUARDRAIL: the Triage agent is read-only and may not write "${rel}".`;

  if (ctx.allowWritePaths && !ctx.allowWritePaths(rel)) return `GUARDRAIL: "${rel}" is outside this agent's allowed write scope for the ${ctx.stage} stage.`;

  const locked = ctx.lockedFiles?.get(rel);
  if (locked) return `GUARDRAIL: "${rel}" is the locked reproduction test (hash ${locked.slice(0, 8)}…) and may not be modified once accepted.`;

  return undefined;
}

function block(ctx: GuardrailContext, toolName: string, args: unknown, reason: string) {
  ctx.onBlock({ ts: new Date().toISOString(), stage: ctx.stage, tool: toolName, input: args, reason });
  return { skip: true, reason };
}

function extractWriteTargets(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "editor" || toolName === "apply_patch") {
    const p = args.path ?? args.file_path;
    return typeof p === "string" ? [p] : [];
  }
  if (toolName === "write_file" || toolName === "write_files") {
    const files = args.files;
    if (Array.isArray(files)) return files.map((f) => (typeof f === "string" ? f : (f as { path?: string }).path)).filter((x): x is string => !!x);
    const p = args.path;
    return typeof p === "string" ? [p] : [];
  }
  return [];
}

function extractCommands(args: Record<string, unknown>): string[] {
  const commands = args.commands;
  if (Array.isArray(commands)) return commands.filter((c): c is string => typeof c === "string");
  const command = args.command;
  return typeof command === "string" ? [command] : [];
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Minimal glob: `*` within a path segment, `**` across segments. */
export function globMatch(rel: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/\\/g, "/")
        .split("**")
        .map((seg) =>
          seg
            .split("*")
            .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
        )
        .join(".*") +
      "$",
  );
  return re.test(rel) || re.test(rel + "/");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function toRel(absOrRel: string, cwd: string): string {
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.join(cwd, absOrRel);
  return path.relative(cwd, abs).replace(/\\/g, "/");
}
