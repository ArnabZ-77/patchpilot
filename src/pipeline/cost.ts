import { INR_PER_USD } from "../config.ts";
import type { Incident, UsageTotals } from "../types.ts";

/** USD per million tokens: [input, output, cacheRead, cacheWrite5m]. Anthropic list prices as of 2026-10. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-opus-4-8": [5, 25, 0.5, 6.25],
  "claude-opus-4-7": [5, 25, 0.5, 6.25],
  "claude-opus-4-6": [5, 25, 0.5, 6.25],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-sonnet-5": [2, 10, 0.2, 2.5],
  "claude-sonnet-4-6": [3, 15, 0.3, 3.75],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25],
  "claude-fable-5-1": [10, 50, 0.25, 12.5],
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost?: number;
}

export function usdFor(modelId: string, u: TokenUsage): number {
  if (typeof u.totalCost === "number" && u.totalCost > 0) return u.totalCost;
  const key = Object.keys(PRICES).find((k) => modelId.startsWith(k));
  const [inp, out, cr, cw] = key ? PRICES[key]! : [3, 15, 0.3, 3.75];
  return (u.inputTokens * inp + u.outputTokens * out + u.cacheReadTokens * cr + u.cacheWriteTokens * cw) / 1e6;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, inr: 0, byStage: {} };
}

export function addUsage(inc: Incident, stage: string, modelId: string, u: TokenUsage): void {
  const usd = usdFor(modelId, u);
  const t = inc.usage;
  t.inputTokens += u.inputTokens;
  t.outputTokens += u.outputTokens;
  t.cacheReadTokens += u.cacheReadTokens;
  t.cacheWriteTokens += u.cacheWriteTokens;
  t.usd = Number((t.usd + usd).toFixed(6));
  t.inr = Number((t.usd * INR_PER_USD).toFixed(2));
  const s = (t.byStage[stage] ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0 });
  s.inputTokens += u.inputTokens;
  s.outputTokens += u.outputTokens;
  s.cacheReadTokens += u.cacheReadTokens;
  s.cacheWriteTokens += u.cacheWriteTokens;
  s.usd = Number((s.usd + usd).toFixed(6));
}

export function formatInr(inr: number): string {
  return `₹${inr.toFixed(2)}`;
}
