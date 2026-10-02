import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PatchPilotConfig, RepoConfig } from "./types.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(PROJECT_ROOT, ".patchpilot");
export const INCIDENTS_DIR = path.join(DATA_DIR, "incidents");
export const SANDBOX_DIR = path.join(DATA_DIR, "sandboxes");

loadDotEnv(path.join(PROJECT_ROOT, ".env"));

/** Minimal .env loader (no dependency): KEY=value lines, # comments, no expansion. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const DEFAULTS: PatchPilotConfig = {
  repos: {},
  defaultRepo: "demo-app",
  maxFixAttempts: 3,
  minTriageConfidence: 0.35,
};

export function loadConfig(): PatchPilotConfig {
  const file = path.join(PROJECT_ROOT, "patchpilot.config.json");
  const raw = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PatchPilotConfig>) : {};
  const cfg: PatchPilotConfig = { ...DEFAULTS, ...raw, repos: { ...(raw.repos ?? {}) } };
  for (const [name, repo] of Object.entries(cfg.repos)) {
    cfg.repos[name] = normalizeRepo(repo);
  }
  return cfg;
}

function normalizeRepo(repo: RepoConfig): RepoConfig {
  return {
    ...repo,
    root: path.resolve(PROJECT_ROOT, repo.root),
    subdir: (repo.subdir ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    testPaths: repo.testPaths.map((p) => p.replace(/\\/g, "/").replace(/\/+$/g, "")),
    protectedPaths: repo.protectedPaths.map((p) => p.replace(/\\/g, "/")),
    maxDiffLines: repo.maxDiffLines ?? 200,
    maxDiffFiles: repo.maxDiffFiles ?? 5,
  };
}

export interface ModelSettings {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Providers whose tools execute inside the provider process (the Claude Code
 * CLI, OpenAI Codex CLI, ...). PatchPilot's `beforeTool` guardrail never sees
 * those calls, so such providers are refused unless explicitly allowed.
 */
const PROVIDER_EXECUTED_TOOLS = new Set(["claude-code", "openai-codex-cli", "opencode"]);

export function resolveModelSettings(): ModelSettings {
  const providerId = process.env.PATCHPILOT_PROVIDER || "anthropic";
  const modelId = process.env.PATCHPILOT_MODEL || "claude-opus-5-5";
  if (PROVIDER_EXECUTED_TOOLS.has(providerId) && process.env.PATCHPILOT_ALLOW_PROVIDER_TOOLS !== "1") {
    throw new Error(
      `Provider "${providerId}" executes its own tools inside the CLI process, so PatchPilot's PreToolUse guardrails cannot intercept them. ` +
        `Use an API provider (anthropic, openai-compatible, ollama, bedrock, ...) or set PATCHPILOT_ALLOW_PROVIDER_TOOLS=1 to accept unguarded runs.`,
    );
  }
  const apiKey =
    process.env.PATCHPILOT_API_KEY ||
    (providerId === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined) ||
    (providerId.startsWith("openai") ? process.env.OPENAI_API_KEY : undefined) ||
    (providerId === "gemini" ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY : undefined);
  return { providerId, modelId, apiKey, baseUrl: process.env.PATCHPILOT_BASE_URL || undefined };
}

export const INR_PER_USD = Number(process.env.PATCHPILOT_INR_PER_USD || 96);
export const PORT = Number(process.env.PATCHPILOT_PORT || 4747);
export const OPEN_PR = process.env.PATCHPILOT_OPEN_PR === "1";
export const MOCK_MODE = process.env.PATCHPILOT_MOCK === "1";
