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
export async function runAgent(prompt: string, opts: RunAgentOptions): Promise<RunAgentResult> {
  if (MOCK_MODE) return runMockAgent(prompt, opts);

  const agent = new Agent({
    providerId: opts.settings.providerId,
    modelId: opts.settings.modelId,
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
  const result = await agent.run(prompt);
  if (result.status !== "completed") {
    throw new Error(`agent run ${result.status}: ${result.error?.message ?? "no output"}`);
  }
  return { outputText: result.outputText, usage: result.usage, status: result.status };
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
