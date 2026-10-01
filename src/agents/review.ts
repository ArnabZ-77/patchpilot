import type { FixAttempt, Incident, ReviewResult, TriageResult } from "../types.ts";
import type { ModelSettings } from "../config.ts";
import { runAgent, registerMockHandler } from "../pipeline/model.ts";
import { extractJson } from "./util.ts";

// The CodeMender-style critic pass: a model that sees ONLY the diff plus
// the original root cause and intended behavior, with no tools and no
// ability to edit — it can only judge, never fix. Runs after a fix attempt
// is accepted by the hard checks and tests, before the PR opens.
const SYSTEM_PROMPT = `You are Critic, an independent reviewer. You did not write this patch. You cannot edit anything.
Given a root cause, the intended behavior, and a diff, answer three questions honestly and skeptically:
1. Does the diff actually address the stated root cause, or does it look like a workaround / overfit to the specific test?
2. Does the diff change behavior anywhere outside the crash path (unrelated functions, wider error handling, formatting of unrelated code)?
3. What residual risk remains (edge cases the fix might not cover, similar bugs likely to exist elsewhere)?

Respond with ONLY a fenced JSON block:
\`\`\`json
{"confidence": 0.8, "addresses_root_cause": true, "behavior_change_outside_crash_path": false, "risks": ["..."], "open_question": null}
\`\`\``;

export async function runReview(inc: Incident, triage: TriageResult, attempt: FixAttempt, settings: ModelSettings): Promise<ReviewResult & { usage: any }> {
  const prompt = `MOCK_TAG:review
### Root cause
${triage.root_cause}
Intended behavior: ${triage.intended_behavior}

### Fixer's stated hypothesis
${attempt.hypothesis}

### Diff
\`\`\`diff
${attempt.diff.slice(0, 6000)}
\`\`\`

Review this diff and respond with the JSON block only.`;

  const result = await runAgent(prompt, { settings, systemPrompt: SYSTEM_PROMPT, maxIterations: 1 });
  const parsed = extractJson<ReviewResult>(result.outputText);
  const review: ReviewResult = {
    confidence: clamp01(parsed?.confidence ?? 0.5),
    addresses_root_cause: parsed?.addresses_root_cause ?? true,
    behavior_change_outside_crash_path: parsed?.behavior_change_outside_crash_path ?? false,
    risks: parsed?.risks ?? [],
    open_question: parsed?.open_question ?? undefined,
  };
  return Object.assign(review, { usage: result.usage });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

registerMockHandler({
  match: /MOCK_TAG:review/,
  respond: () => "```json\n" + JSON.stringify({ confidence: 0.85, addresses_root_cause: true, behavior_change_outside_crash_path: false, risks: ["Similar unguarded accesses may exist in related functions."], open_question: null }) + "\n```",
});
