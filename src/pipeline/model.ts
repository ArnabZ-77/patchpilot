import { Agent, type AgentRuntimeEvent, type AgentTool } from "@cline/agents";
import type { ModelSettings } from "../config.ts";
import { MOCK_MODE } from "../config.ts";

export interface RunAgentOptions {
  settings: ModelSettings;
  systemPrompt: string;
  tools?: AgentTool<any, any>[];
  maxIterations?: number;
  beforeTool?: (ctx: { tool: AgentTool; toolCall: { toolName: string }; input: unknown }) => { skip?: boolean; reason?: string } | undefined;
  onEvent?: (e: AgentRuntimeEvent) => void;
}

export interface RunAgentResult {
  outputText: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost?: number };
  status: string;
}

/**
 * Thin wrapper around `@cline/agents` `Agent`. Centralizes provider
 * construction, the PreToolUse hook wiring, and a deterministic mock mode
 * (PATCHPILOT_MOCK=1) used by the test suite and offline demos so the whole
 * pipeline is exercisable without API credits.
 */
/** Provider says "busy, try later" (overload, rate limit, quota, or our own stage timeout). Worth waiting and retrying; a code bug is not. */
const TRANSIENT = /high demand|overloaded|rate.?limit|quota|429|503|unavailable|try again|stage timeout/i;
/** Account problems that waiting won't fix: used-up quota, billing, bad key. Fail fast with a clear message instead of retrying. */
const ACCOUNT_PROBLEM = /exceeded your current quota|check your plan and billing|billing|api key not valid|invalid api key|permission denied|unauthorized|401|403/i;
const MAX_TRANSIENT_RETRIES = 3;
/** A stage that runs longer than this is aborted and retried — catches requests the provider accepts but never answers. */
const STAGE_TIMEOUT_MS = Number(process.env.PATCHPILOT_STAGE_TIMEOUT_MS || 240_000);

export async function runAgent(prompt: string, opts: RunAgentOptions): Promise<RunAgentResult> {
  if (MOCK_MODE) return runMockAgent(prompt, opts);

  // Retries restart the stage with a fresh agent after a growing wait. If the
  // primary model stays overloaded, switch to PATCHPILOT_FALLBACK_MODEL (same
  // provider) for the final attempt — a live demo shouldn't die on a busy model.
  const fallback = process.env.PATCHPILOT_FALLBACK_MODEL;
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const useFallback = !!fallback && attempt === MAX_TRANSIENT_RETRIES;
    const modelId = useFallback ? fallback! : opts.settings.modelId;
    if (attempt > 0) {
      const waitMs = 10_000 * attempt;
      opts.onEvent?.({ type: "status-notice", message: `Model busy (${lastError.slice(0, 80)}). Retrying in ${waitMs / 1000}s${useFallback ? ` on fallback model ${modelId}` : ""}…` } as AgentRuntimeEvent);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const agent = new Agent({
      providerId: opts.settings.providerId,
      modelId,
      apiKey: opts.settings.apiKey,
      baseUrl: opts.settings.baseUrl,
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      maxIterations: opts.maxIterations ?? 20,
      hooks: {
        beforeTool: opts.beforeTool as any,
        onEvent: opts.onEvent,
      },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      agent.abort("stage timeout");
    }, STAGE_TIMEOUT_MS);
    const result = await agent.run(prompt).finally(() => clearTimeout(timer));
    if (result.status === "completed") {
      return { outputText: result.outputText, usage: result.usage, status: result.status };
    }
    lastError = timedOut ? `stage timeout after ${STAGE_TIMEOUT_MS / 1000}s with no finished answer` : (result.error?.message ?? "no output");
    if (ACCOUNT_PROBLEM.test(lastError)) {
      throw new Error(`model account problem (not retried): ${lastError}. Check the API key, its quota and billing, or switch PATCHPILOT_PROVIDER/PATCHPILOT_MODEL in .env.`);
    }
    if (!TRANSIENT.test(lastError)) break;
  }
  throw new Error(`agent run failed: ${lastError}`);
}

/**
 * Deterministic stand-in used for CI and local demos without API credits.
 * Each mock handler inspects the prompt for a `MOCK_TAG:` marker the
 * pipeline embeds and returns canned, schema-valid JSON — exercising every
 * downstream code path (parsing, hard checks, PR body) without a live model.
 */
async function runMockAgent(prompt: string, opts: RunAgentOptions): Promise<RunAgentResult> {
  const handler = MOCK_HANDLERS.find((h) => h.match.test(prompt));
  const text = handler ? await handler.respond(prompt, opts) : "{}";
  return { outputText: text, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, status: "completed" };
}

interface MockHandler {
  match: RegExp;
  respond: (prompt: string, opts: RunAgentOptions) => Promise<string> | string;
}

const MOCK_HANDLERS: MockHandler[] = [];
export function registerMockHandler(h: MockHandler): void {
  MOCK_HANDLERS.unshift(h);
}
