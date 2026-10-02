import type { Incident, TriageResult } from "../types.ts";
import type { RepoConfig } from "../types.ts";
import type { ModelSettings } from "../config.ts";
import { runAgent, registerMockHandler } from "../pipeline/model.ts";
import { makeReadFileTool, makeSearchTool } from "../pipeline/tools.ts";
import { makeBeforeTool } from "../pipeline/guardrails.ts";
import { rankSuspectsFromFrames, repoTree } from "./localize.ts";
import { extractJson } from "./util.ts";
import { findMockFixture } from "../pipeline/mockFixtures.ts";

const SYSTEM_PROMPT = `You are Triage, a careful software maintainer investigating a production crash.
You are read-only: you may read files and search the codebase, but you may never write or run commands.
Your job is to find the TRUE root cause — not a superficial symptom — and name the suspect locations an engineer should fix.

Investigate like this:
1. Read the stack trace and the suspect functions it points to (already ranked for you).
2. Use search_codebase / read_file to confirm what the code actually does at and around each suspect, and to check for related call sites.
3. For each location you keep, state the file, symbol, line range, and the INTENDED behavior the fix should restore (this preserves existing functionality elsewhere).
4. Give one root_cause sentence in a "matter of fact" tone, e.g. "computeTotal did not check that item.price was defined, because callers can pass partial Item objects."
5. If the evidence is too thin to be confident, set confidence low and explain what's missing in needs_human.

When you are done, respond with ONLY a fenced JSON block (no other text) of this exact shape:
\`\`\`json
{
  "root_cause": "one sentence, matter-of-fact",
  "intended_behavior": "what the fixed code should do",
  "suspects": [{"file": "src/x.ts", "symbol": "fn", "startLine": 10, "endLine": 20, "score": 0.9, "evidence": ["stack_frame"], "reason": "..."}],
  "confidence": 0.8,
  "needs_human": null
}
\`\`\``;

export async function runTriage(inc: Incident, repo: RepoConfig, settings: ModelSettings, cwd: string, onEvent?: (type: string, text?: string) => void): Promise<TriageResult> {
  const stackSuspects = rankSuspectsFromFrames(inc.frames, cwd);
  const tree = repoTree(cwd);
  const exc = inc.events[0]?.exception.values.at(-1);

  const prompt = `MOCK_TAG:triage
Investigate this production crash.

### Exception
${exc?.type ?? "Error"}: ${exc?.value ?? inc.title}
Transaction: ${inc.transaction ?? "unknown"}
Occurrences: ${inc.occurrences}

### Stack-derived suspects (ranked by closeness to the throw site; you MUST inspect these, but you may find the real cause elsewhere)
${stackSuspects.map((s) => `- ${s.file}${s.symbol ? `:${s.symbol}` : ""} (lines ${s.startLine}-${s.endLine}, score ${s.score}) — ${s.reason}`).join("\n") || "(no in-app frames)"}

### Repository structure
${tree}

Use read_file and search_codebase to confirm the root cause, then respond with the JSON block only.`;

  const beforeTool = makeBeforeTool({
    stage: "triage",
    repo,
    cwd,
    onBlock: (b) => onEvent?.("guardrail-block", b.reason),
  });

  const result = await runAgent(prompt, {
    settings,
    systemPrompt: SYSTEM_PROMPT,
    tools: [makeReadFileTool(cwd), makeSearchTool(cwd)],
    maxIterations: 14,
    beforeTool,
    onEvent: (e) => {
      if (e.type === "tool-started") onEvent?.("tool", `${e.toolCall.toolName} ${JSON.stringify(e.toolCall.input).slice(0, 160)}`);
      if (e.type === "status-notice") onEvent?.("notice", e.message);
      if (e.type === "assistant-text-delta") onEvent?.("text-delta", e.text);
    },
  });

  inc.usage; // usage recorded by caller via result.usage
  const parsed = extractJson<Partial<TriageResult>>(result.outputText);
  const triage: TriageResult = {
    root_cause: parsed?.root_cause ?? "Unable to determine root cause from the agent response.",
    intended_behavior: parsed?.intended_behavior ?? "",
    suspects: (parsed?.suspects?.length ? parsed.suspects : stackSuspects) as TriageResult["suspects"],
    confidence: clamp01(parsed?.confidence ?? (parsed ? 0.5 : 0.1)),
    needs_human: parsed?.needs_human ?? undefined,
  };
  return Object.assign(triage, { __usage: result.usage }) as TriageResult & { __usage: typeof result.usage };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// --- deterministic mock for offline/CI runs ---
registerMockHandler({
  match: /MOCK_TAG:triage/,
  respond: (prompt) => {
    const found = findMockFixture(prompt);
    if (!found) {
      return "```json\n" + JSON.stringify({ root_cause: "", intended_behavior: "", suspects: [], confidence: 0.1, needs_human: "mock mode: no known fixture matched this prompt" }) + "\n```";
    }
    const { file, fixture } = found;
    return "```json\n" +
      JSON.stringify(
        {
          root_cause: fixture.rootCause,
          intended_behavior: fixture.intendedBehavior,
          suspects: [{ file, symbol: fixture.symbol, startLine: 1, endLine: 20, score: 0.9, evidence: ["stack_frame", "llm"], reason: "confirmed by reading the function" }],
          confidence: 0.85,
          needs_human: null,
        },
        null,
        2,
      ) +
      "\n```";
  },
});
