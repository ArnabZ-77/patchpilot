# PatchPilot

**Turn a production crash into a tested pull request.** Open-source, self-hostable,
test-first, guardrailed.

PatchPilot listens for crashes (or plain-English bug reports) from a target app, then
runs three guardrailed sub-agents — **Triage → Reproducer → Fixer** — in an isolated git
worktree, followed by an independent **Critic** review, and opens a draft pull request.
Nothing merges itself; a human always reviews.

```
crash/report → Triage (read-only) → Reproducer (writes a failing test) →
  Fixer ×≤3 (edits source, never tests) → Critic → draft PR
```

Every stage is guardrailed by a `beforeTool` hook, not just a prompt: the Fixer's write
tool physically refuses to touch test files, protected paths, or the locked reproduction
test, and a destructive shell command is blocked before it runs — see
[Design rationale](#design-rationale) for why.

## Quick start

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY, or leave PATCHPILOT_MOCK=1 to try it free
npm run typecheck && npm test   # 29 unit tests, no API key needed
```

### 1. Try it with zero API cost (mock mode)

```bash
PATCHPILOT_MOCK=1 npm run bench
```

Runs the full pipeline against all 10 planted bugs in the demo app and prints the
mini-benchmark report (fix rate, reproduction rate, cost, guardrail blocks — see
[Evaluation](#evaluation)). No network calls, no API key.

### 2. Watch it live

```bash
# terminal 1
PATCHPILOT_MOCK=1 npm start          # PatchPilot + dashboard on :4747
# terminal 2
npm run demo                         # the target app on :5050
# terminal 3
PATCHPILOT_MOCK=1 npm run demo:crash # fires all 10 planted bugs
```

Open **http://localhost:4747** — the dashboard streams each incident live via SSE:
stage progress, the Triage root cause, the Reproducer's failing test, every Fixer
attempt with its hard-check results, the Critic's review, and the final diff.

Drop `PATCHPILOT_MOCK=1` and set `ANTHROPIC_API_KEY` in `.env` to run it for real.

## How it works

### Capture

`sdk/patchpilot-express.js` is a zero-dependency Express error middleware that builds a
Sentry-shaped event (`exception.values[]`, `stacktrace.frames[]`, in-app flags,
breadcrumbs) and POSTs it to PatchPilot. Incidents are deduplicated by **fingerprint**:
exception type + the top in-app stack frames (module, filename, function, normalized
context line) — deliberately excluding line numbers, so an unrelated edit above the
crash site doesn't spawn a new incident (the same algorithm Sentry uses, see
`src/capture/fingerprint.ts`).

Not every bug throws — a wrong conditional or an off-by-one slice never crashes in JS.
`POST /api/incidents/manual` accepts a plain-English report instead, which is how most
non-crash bugs actually reach a team. Both paths feed the same pipeline.

### Pipeline (`src/pipeline/orchestrator.ts`)

1. **Sandbox** — a fresh `git worktree` per incident (`src/pipeline/sandbox.ts`), so a
   bad edit never touches the real checkout. Forced to LF line endings regardless of the
   host's `core.autocrlf`, because the Fixer's edit tool matches text byte-for-byte.
2. **Triage** (read-only) — ranks suspect functions from the stack trace (closest frame
   to the throw scores highest), then investigates with `read_file`/`search_codebase`
   tools, and returns a root cause, the intended behavior, and a confidence score. Below
   `minTriageConfidence` (0.35 by default), the incident escalates immediately instead of
   guessing.
3. **Reproducer** — writes exactly one regression test, restricted to the repo's test
   directories. PatchPilot *independently* re-runs that test against the unmodified tree
   and rejects the result if it doesn't fail with a real assertion — the agent's own
   claim is never trusted. The accepted test file is then content-hashed and locked.
4. **Fixer** (≤3 attempts) — edits source only. A `beforeTool` hook makes the test file
   and all protected paths (config, secrets, migrations) physically unwritable, not just
   discouraged by prompt. After each attempt: hard diff-shape checks (size caps, no
   `.skip`/`.only`, no new `jest.mock`, no `valueOf`/`toJSON` overrides — the
   ImpossibleBench cheating taxonomy), then the reproduction test, then the **full**
   suite. Any failure reverts the sandbox and feeds a bounded failure summary into the
   next attempt. The Fixer can also call `flag_for_human_intervention` if it believes the
   test itself is wrong, rather than contorting the code to satisfy it.
5. **Critic** — an independent model pass that sees only the diff and the stated root
   cause (no tools, can't edit) and judges: does this address the root cause, does it
   change behavior outside the crash path, what's the residual risk.
6. **PR** — a draft PR body with root cause, evidence, the reproduction test, full
   verification output, and an explicit "what the agent did not do" section. Opened with
   `gh` when `PATCHPILOT_OPEN_PR=1` and a GitHub remote exist; otherwise the commit and
   branch are left ready in the sandbox.

An incident that exhausts its attempts, or that the Fixer flags, ends at **Needs Human**
with the reason recorded — never a forced merge.

## Project layout

```
sdk/patchpilot-express.js   capture middleware (the only piece a target app imports)
src/
  capture/                  fingerprinting, incident construction
  agents/                   triage.ts, reproduce.ts, fix.ts, review.ts + localize.ts
  pipeline/                 orchestrator, sandbox, test runner, guardrails, hard checks,
                             cost accounting, PR body, Cline Agent wrapper, mock fixtures
  server.ts                 webhook + manual intake + SSE + REST, serves dashboard/
dashboard/index.html        single-file live dashboard (no build step)
demo-app/                   tiny Express app with 10 planted bugs across 5 categories
benchmark/golden/           hidden regression tests (never shown to any agent) + bug catalog
benchmark/run.ts            mini-benchmark: runs the pipeline against all 10, grades
                             against the hidden tests, reports the metrics table
scripts/crash.ts            fires a planted bug at a running demo-app/PatchPilot pair
tests/                      PatchPilot's own unit tests (vitest)
```

## Guardrails (not just a prompt)

| Risk (from the literature) | Mitigation | Where |
|---|---|---|
| Agent deletes/edits the failing test to "pass" (ImpossibleBench, ICLR 2026) | `beforeTool` hook physically refuses writes to test paths during `fix`; the accepted test is content-hashed and locked | `src/pipeline/guardrails.ts` |
| Plausible-but-wrong patches (~30% of "passing" patches behave differently from the human fix — PatchDiff, ICSE 2026) | Full suite run, not just the new test; independent Critic pass; confidence shown in the PR | `src/pipeline/testrunner.ts`, `src/agents/review.ts` |
| Skipped tests, new mocks of the module under test, equality-operator overloads | Diff-shape hard checks after every attempt | `src/pipeline/hardchecks.ts` |
| Destructive/exfiltrating shell commands | Regex-blocked before execution (`rm -rf`, `git push --force`, `curl`, …) | `src/pipeline/guardrails.ts` |
| Secrets/config/migrations edited | Protected-path list, enforced the same way as the test-file lock | `patchpilot.config.json` |
| Agent wanders indefinitely | Hard iteration caps per stage, ≤3 fix attempts, then honest escalation | `src/pipeline/orchestrator.ts` |

Every block is logged to `incident.guardrailBlocks` and shown on the dashboard.

## Evaluation

`npm run bench` plants and grades all 10 bugs with a **hidden golden test per bug**
(`benchmark/golden/*.test.js`, never passed to any agent — the same idea as SWE-bench's
`FAIL_TO_PASS`). It reports:

| Metric | How it's measured |
|---|---|
| Fix rate | share of bugs whose PR passes its hidden golden test |
| Reproduction rate | share where the Reproducer's own test failed before the fix (independently verified) |
| Time to PR | webhook/report received → PR ready |
| Cost per fix | real token usage × published per-model pricing, shown in ₹ |
| Unsafe actions blocked | count of `beforeTool` cancellations |
| Escalation count | incidents honestly routed to Needs Human |

In mock mode (`PATCHPILOT_MOCK=1`), the pipeline runs against deterministic,
hand-verified fixtures instead of a live model — every stage, hook, and check still
executes for real (real git worktrees, real `node --test` runs, real diffs) — so the
whole thing is demonstrable and CI-testable at zero cost. The 10 planted bugs
intentionally have no unfixable one, so "escalation count" there is a known 0/10 — add an
intentionally-broken test as an 11th fixture if you want to exercise that path.

## Configuration

`patchpilot.config.json` maps a repo name to its sandbox rules:

```jsonc
{
  "repos": {
    "demo-app": {
      "root": ".", "subdir": "demo-app",
      "testCommand": ["node", "--test"],
      "testPaths": ["tests"],
      "protectedPaths": ["server.js", "package.json", ".env", ".env.*"],
      "maxDiffLines": 150, "maxDiffFiles": 3
    }
  }
}
```

Add another repo by adding another entry — PatchPilot is not demo-app-specific.
`PATCHPILOT_PROVIDER`/`PATCHPILOT_MODEL` select any `@cline/llms` provider (Anthropic,
OpenAI-compatible, Ollama, Bedrock, …), so a small team can run it fully self-hosted. The
`claude-code` / `openai-codex-cli` providers run tools inside their own CLI process,
where PatchPilot's hook can't see them — `resolveModelSettings()` refuses those unless
you explicitly opt in, because an unguarded run defeats the point.

## Status and honest limitations

- The git-worktree sandbox isolates the working tree, not the OS — for untrusted
  third-party code, put the sandbox dir in a container too (the code is structured to
  make that a deployment change, not a rewrite).
- `gh pr create` integration is best-effort; without `gh`/a GitHub remote, PatchPilot
  still leaves a clean committed branch in the sandbox.
- The demo app's 10 bugs are hand-authored and the mock fixtures are hand-verified
  against them — a real model will sometimes reproduce or fix a bug differently (or not
  at all); that's what `PATCHPILOT_MOCK=0` + `npm run bench` is for.

## Attribution

Built on the [Cline SDK](https://github.com/cline/cline) (`@cline/agents` for the agent
loop and `beforeTool` hooks, `@cline/llms` for the provider gateway). Design choices are
traced to specific research in code comments — Agentless (FSE 2025) for the fixed
localize→repair→validate pipeline shape, SWT-Bench (NeurIPS 2024) for the F→P
reproduction-test acceptance rule, AutoCodeRover (ISSTA 2024) for structured code search,
RepairAgent (ICSE 2025) for the hypothesis/retry discipline, and ImpossibleBench /
PatchDiff for the guardrail design.
