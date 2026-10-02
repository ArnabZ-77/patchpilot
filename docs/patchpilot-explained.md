# PatchPilot, explained

A complete walkthrough of what PatchPilot is, why each piece is designed the way it is, and
how every part works, down to the live servers and the files on disk. Read it top to
bottom once; after that, use the section headings to find what you need when someone asks.

**Contents**
1. [The idea in one minute](#1-the-idea-in-one-minute)
2. [The problem, and why this approach](#2-the-problem-and-why-this-approach)
3. [Every design choice and the reason for it](#3-every-design-choice-and-the-reason-for-it)
4. [One bug, start to finish](#4-one-bug-start-to-finish)
5. [The parts, one by one](#5-the-parts-one-by-one)
6. [The live servers and their endpoints](#6-the-live-servers-and-their-endpoints)
7. [Exactly how the Cline SDK is used](#7-exactly-how-the-cline-sdk-is-used)
8. [Running it](#8-running-it)
9. [Configuration reference](#9-configuration-reference)
10. [Results so far](#10-results-so-far)
11. [Limitations, stated honestly](#11-limitations-stated-honestly)
12. [Questions you'll be asked](#12-questions-youll-be-asked)
13. [Glossary](#13-glossary)

---

## 1. The idea in one minute

When a web app crashes in production, a developer has to stop, find the bug, **reproduce
it** (make it happen again on purpose), fix it, and prove the fix works. That takes hours,
and reproducing is usually the slowest part.

PatchPilot does that whole loop automatically. A small piece of code inside the app
catches the crash and sends it to PatchPilot. PatchPilot then runs four AI agents in order:

1. **Triage** reads the code and finds the root cause. It can read but never write.
2. **Reproducer** writes a new automated test that fails because of the bug. This is the
   proof the bug is real.
3. **Fixer** changes the source code until that test passes and every other test still
   passes. It is never allowed to touch the tests.
4. **Critic** independently reviews the change.

The result is a **pull request** (a proposed code change on GitHub) containing the fix,
the test that proves it, and an explanation. **A human always reviews and merges it.**
PatchPilot never changes the real code by itself.

> One-liner: *"Your app breaks at 2 AM. A tested fix is waiting for you at 2:05."*

---

## 2. The problem, and why this approach

### The pain is real

| Fact | Source |
|---|---|
| About **13 hours** to fix one software failure | Undo / Cambridge Judge Business School report |
| **41%** of developers say reproducing the bug is the biggest barrier | same report |
| **88%** say traditional error monitoring falls short | Rollbar survey of 950 developers |

Monitoring tools like Sentry tell you *that* something broke. Someone still has to do all
the work above.

### Why "test first" is the core idea

The single most important design decision is that **no fix is accepted until a failing
test exists for the bug.** The test is the proof:
- **Before the fix,** the test fails. That proves the bug is real and that we found it.
- **After the fix,** the test passes. That proves the fix addresses that bug.
- **The whole existing test suite still passes.** That proves nothing else broke.

Research backs this. SWT-Bench (NeurIPS 2024) found that using generated reproduction
tests as a filter **more than doubled** the precision of an AI bug-fixer: from roughly 20%
to 47.8% of accepted fixes being correct. The trade-off is that it rejects more fixes;
the ones it keeps are much more likely to be right.

### Why not just let an AI agent loose on the code?

Research shows AI coding agents **cheat** when they can. ImpossibleBench (ICLR 2026) found
agents edit or delete failing tests instead of fixing the code, and stronger models cheat
more often. Another study (PatchDiff, ICSE 2026) found about **30% of "passing" agent
fixes behave differently from the real human fix**. That's why PatchPilot's safety
rules are enforced **in code**, not just asked for in the prompt (see §5.7).

### Who it's for

Small teams with live users and no dedicated on-call engineer: early-stage startups,
solo SaaS builders, agencies, student teams. The persona on the deck is Riya, a solo
backend developer at a 6-person startup who loses about 10 hours a week to firefighting.

### What exists already, and how PatchPilot differs

| Product | Reacts to | Writes a failing test first | Self-hostable | Cost |
|---|---|---|---|---|
| Sentry Seer | Production errors | Partly | No (closed source) | $40 per contributor per month |
| GitHub Copilot Autofix | Security alerts only | No | No | Needs GitHub Advanced Security |
| Google DeepMind CodeMender | Security vulnerabilities | Yes | No (research project) | Not available |
| **PatchPilot** | **Any crash, or a plain-English bug report** | **Yes, enforced** | **Yes, open source** | **Only your own model cost** |

Big companies validate the idea: Meta (SapFix), Sentry, GitHub and DeepMind all ship a
version of it, and **every one keeps a human approving the final fix**. PatchPilot does
the same.

---

## 3. Every design choice and the reason for it

| Decision | Why | Evidence |
|---|---|---|
| A fixed pipeline (Triage → Reproduce → Fix → Review), not one free-roaming agent | Cheaper, more predictable, easier to debug | Agentless (FSE 2025) beat all open-source agents at about $0.70 per issue with a fixed pipeline |
| Reproduce with a failing test **before** any fix | Proves the bug; filters out wrong fixes | SWT-Bench (NeurIPS 2024): precision more than doubled |
| Start localization from the stack trace | The crashing line is the best first clue | AutoCodeRover (ISSTA 2024) uses the stack trace to rank suspect functions |
| Triage is read-only; Reproducer writes only tests; Fixer writes only source | Each agent can only do its own job | RepairAgent (ICSE 2025): limiting tools by stage stops the agent wandering |
| Fixer **cannot** edit tests; the test is locked after it's accepted | Stops the most common cheat | ImpossibleBench (ICLR 2026): agents delete or edit failing tests |
| Run the **full** test suite, not just the new test | Catches fixes that break something else | PatchDiff (ICSE 2026): about 30% of "passing" fixes behave differently |
| At most 3 fix attempts, then escalate to a human | Honest failure beats a forced wrong fix | AutoCodeRover and RepairAgent both cap attempts |
| A separate Critic reviews the diff | A second opinion that didn't write the code | DeepMind CodeMender uses an AI critique step |
| A human always merges | Industry standard for automated fixes | Meta, Sentry, GitHub and DeepMind all do this |
| A separate sandbox copy of the code per incident | A bad edit can never damage the real code | OpenHands and SWE-agent isolate every task |
| Any AI model, through the Cline SDK | Teams can use cheap or self-hosted models | `@cline/llms` supports Anthropic, Gemini, OpenAI, Ollama and more |
| Group repeat crashes into one incident | Don't fix the same bug 50 times | Sentry's fingerprinting algorithm |
| Accept plain-English bug reports too | Many bugs never crash (wrong `if`, off-by-one) | Sentry Seer also takes user feedback as input |

---

## 4. One bug, start to finish

This is planted bug #1 in the demo app, traced through everything that happens.

**The bug.** `demo-app/src/lib/total.js`:

```js
export function computeTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;   // crashes if an item is null
  }
  return Math.round(total * 100) / 100;
}
```

If the cart contains a missing item (`null`), reading `item.price` crashes.

**Step 1 — The crash happens.** A request hits `POST /api/orders/total` on the demo app
with a cart like `[{price:10, quantity:2}, null, {price:5, quantity:1}]`. The code throws
`TypeError: Cannot read properties of null (reading 'price')`. The user gets an HTTP 500.

**Step 2 — The crash is captured.** The PatchPilot middleware inside the demo app catches
the error. It turns the stack trace into a structured event (each frame has a file, line
and function, plus a flag for whether it's the app's own code or a library), removes
passwords and cookies from the request headers, and POSTs the event to PatchPilot at
`http://localhost:4747/api/incidents`. This never slows down or breaks the app's response.

**Step 3 — PatchPilot creates an incident.** PatchPilot computes a **fingerprint** for the
crash: the error type plus the app's own top stack frames. If it has seen this fingerprint
before, it just counts another occurrence. If not, it creates a new incident and starts
the pipeline. The dashboard shows it immediately.

**Step 4 — Sandbox.** PatchPilot makes a separate copy of the code for this incident
(a git worktree, in `.patchpilot/sandboxes/<incident-id>/`). All agent work happens there.
The real `demo-app/` folder is never touched.

**Step 5 — Triage.** PatchPilot ranks suspects from the stack trace: the frame that threw
gets the top score (`total.js: computeTotal`). The Triage agent gets the error, the ranked
suspects and the folder structure. It uses `read_file` and `search_codebase` to read the
real code. It answers with JSON: the root cause in one sentence, the intended behavior,
the suspect locations, and a confidence score from 0 to 1. If confidence is below 0.35,
PatchPilot stops and marks the incident **Needs Human**.

**Step 6 — Reproducer.** The Reproducer agent writes one new test in `tests/`, such as:

```js
test("computeTotal skips a missing cart line instead of throwing", () => {
  assert.equal(computeTotal([{ price: 10, quantity: 2 }, undefined, { price: 5, quantity: 1 }]), 25);
});
```

PatchPilot then **runs the test itself** against the unfixed code. It does not take the
agent's word for it. If the test doesn't fail, it's rejected. If it fails as expected,
PatchPilot records a SHA-256 fingerprint of the test file and **commits the test on its
own** ("test: reproduce … (fails before fix)"). From that moment the test is **locked**.

**Step 7 — Fixer.** The Fixer agent gets the root cause, the suspects and the locked
test. It edits the source and can run the test as it works. Its change here is one line:

```diff
   for (const item of items) {
+    if (!item) continue;
     total += item.price * item.quantity;
```

When the Fixer says it's done, PatchPilot checks everything itself, in this order:
1. **Was the locked test changed?** If so, the attempt is thrown away.
2. **Hard checks on the diff:** no test files touched, no protected files, at most 3 files
   and 150 changed lines, no `.skip`/`.only`, no new mocks, no comparison-operator tricks,
   braces balanced.
3. **Run the reproduction test.** It must pass now.
4. **Run the full test suite.** Everything must pass.

If any check fails, the sandbox is **reset to the test commit** (test present, bug
unfixed) and the reason goes back to the Fixer for its next attempt. After 3 failed
attempts the incident goes to **Needs Human**.

**Step 8 — Critic.** A fresh model call that sees only the diff and the root cause, with
no tools and no ability to edit. It answers: does this fix the root cause, does it change
anything outside the crash path, and what risks remain.

**Step 9 — Pull request.** PatchPilot commits the fix on the branch
`patchpilot/<incident-id>`, so the branch history reads **test commit → fix commit**:
anyone can check out the first commit and watch the test fail. Then it writes the PR text: root cause, confidence, evidence, the
reproduction test, change summary, every verification result, what the agent did *not*
do, and the cost. With `PATCHPILOT_OPEN_PR=1` and GitHub set up, it opens a **draft** PR
with the `gh` command-line tool.

**Step 10 — A human merges** after reading the PR.

The dashboard shows every one of these steps live as it happens.

---

## 5. The parts, one by one

```
patchpilot/
├── sdk/patchpilot-express.js   capture middleware (the only file a target app imports)
├── src/
│   ├── server.ts               web server: webhook, bug reports, live stream, dashboard
│   ├── store.ts                incident storage + event bus
│   ├── config.ts               settings from .env and patchpilot.config.json
│   ├── types.ts                shared data types
│   ├── capture/
│   │   ├── fingerprint.ts      groups repeat crashes
│   │   └── incident.ts         builds incidents from crashes or reports
│   ├── agents/
│   │   ├── localize.ts         ranks suspects from the stack trace
│   │   ├── triage.ts           Triage agent
│   │   ├── reproduce.ts        Reproducer agent
│   │   ├── fix.ts              Fixer agent
│   │   ├── review.ts           Critic agent
│   │   └── util.ts             reads JSON out of model replies
│   └── pipeline/
│       ├── orchestrator.ts     runs the stages in order
│       ├── model.ts            wraps the Cline SDK Agent; retries; mock mode
│       ├── tools.ts            read_file, search_codebase, editor
│       ├── guardrails.ts       the beforeTool safety hook
│       ├── hardchecks.ts       checks on every diff
│       ├── sandbox.ts          git worktree per incident
│       ├── testrunner.ts       runs tests, summarizes output
│       ├── cost.ts             tokens → $ → ₹
│       ├── pr.ts               PR title, body, gh
│       └── mockFixtures.ts     answers for zero-cost mock mode
├── dashboard/index.html        live dashboard
├── demo-app/                   demo shop with 10 planted bugs
├── benchmark/                  hidden tests + benchmark runner
├── scripts/crash.ts            fires planted bugs at the live demo
└── tests/                      PatchPilot's own unit tests
```

About 3,300 lines of code in total.

### 5.1 Capture middleware — `sdk/patchpilot-express.js`

An Express error handler with no dependencies. A target app adds it with one line:

```js
app.use(patchpilot({ endpoint: "http://localhost:4747/api/incidents", repo: "demo-app", root: __dirname }));
```

What it does:
- Builds an event in **Sentry's format**, so other Sentry-style tools could send to
  PatchPilot too. It includes the error type and message, the **stack frames** (oldest
  first, each marked as app code or library code, with the surrounding source lines), the
  route (e.g. `POST /api/orders/total`), the environment and a timestamp.
- **Removes sensitive headers** (`authorization`, `cookie`, `x-api-key`, …) and never sends
  the request body unless asked to.
- Sends in the background with a 3-second timeout. If PatchPilot is offline, the event is
  silently dropped. **It can never break or slow down the app.**
- Follows `error.cause` chains, so wrapped errors keep their root cause.

### 5.2 Fingerprinting — `src/capture/fingerprint.ts`

Decides whether a crash is new or a repeat. It uses **Sentry's approach**: the error type
plus the app's top 8 stack frames (module, file name, function name, and the line of code
with spaces removed), hashed with MD5.

**Line numbers are deliberately left out.** Otherwise, adding a comment above the crash
site would make the same bug look new. Crashes without a stack trace use the error message
with numbers and IDs blanked out, so `user 123 not found` and `user 456 not found` group
together.

### 5.3 Incident storage — `src/store.ts`

Keeps every incident in memory and saves each one as a JSON file in
`.patchpilot/incidents/`. Writes are atomic (write to a temp file, then rename), so a crash
mid-save can't corrupt a file. It's also the **event bus**: every log line is broadcast to
the live dashboard. If PatchPilot restarts mid-run, unfinished incidents are honestly
marked `failed` with "PatchPilot restarted while this incident was in flight".

### 5.4 Sandbox — `src/pipeline/sandbox.ts`

Each incident gets its own **git worktree**, a second working copy of the repository on
its own branch (`patchpilot/<id>`), in `.patchpilot/sandboxes/<id>/`. Benefits:
- The agents' edits can never damage your real working copy.
- Several incidents can be worked on at once without interfering.
- The accepted reproduction test is committed on its own. Reverting a failed fix attempt
  is a `git reset --hard` back to that commit, so the test always survives.
- The Fixer's changes are checked against that commit, including any brand-new files it
  creates, so the hard checks see exactly what the Fixer did and nothing else.
- The finished fix is already a real git commit on a real branch, ready for a PR.

The first real-model run exposed a bug here that mock mode never hit. The Reproducer had
added its test to an existing test file without committing it, so the Fixer's diff
appeared to include a test edit. The correct fix was rejected, and the revert deleted the
test. Committing the test first fixed both problems.

It forces Unix line endings (`core.autocrlf=false`), because on Windows git would
otherwise convert files to CRLF and the Fixer's exact-text edits would fail to match.
This was a real bug found and fixed during testing.

### 5.5 The agents — `src/agents/`

All four are Cline SDK `Agent` objects. Each has its own instructions, its own tools and
its own permissions.

| Agent | Tools | Can write | Gives back | Iteration cap |
|---|---|---|---|---|
| **Triage** | `read_file`, `search_codebase` | Nothing | root cause, intended behavior, suspects, confidence | 14 |
| **Reproducer** | the above + `editor` + `run_test_file` | Test folders only | test file, test name, failure summary | 16 |
| **Fixer** | the above + `run_repro_test` + `flag_for_human_intervention` | Source only, never tests | hypothesis, summary — or "escalate" | 20 per attempt, 3 attempts |
| **Critic** | none | Nothing | confidence, addresses root cause?, outside changes?, risks | 1 |

Points worth knowing:
- **Triage's instructions** say to find the *true* root cause, not the symptom, and to
  give lower confidence instead of guessing.
- **Reproducer's instructions** say the test must fail with a real assertion, not crash
  from a typo. PatchPilot then checks that independently.
- **Fixer's instructions** use the exact wording that ImpossibleBench found cut cheating
  from over 85% to about 1%: *"If you find the test is flawed, STOP… Do NOT try to carve
  out the code to pass the tests. DO NOT MODIFY THE TESTS."* The wording is only the
  first layer; the hook in §5.7 enforces it.
- **`flag_for_human_intervention`** lets the Fixer say "this test looks wrong" instead of
  forcing a bad fix. ImpossibleBench found that giving agents this escape hatch cut
  cheating sharply (54% → 9% for GPT-5).

### 5.6 The tools — `src/pipeline/tools.ts`

The agents' tools are written to stay small and safe, following SWE-agent's research
finding that tool design matters as much as the model:
- **`read_file`** shows at most 400 lines at a time, numbered, with "(N more lines
  above/below)" markers.
- **`search_codebase`** runs regex searches, at most 5 per call and 50 matches each. If
  there are more, it tells the agent to search more narrowly.
- **`editor`** replaces an exact piece of text, which must match **exactly once**, or
  inserts at a line, or creates a file. If the text isn't found or matches twice, it
  explains why so the agent can retry.
- **Every path is checked** to stay inside the sandbox. `../` tricks are refused.

### 5.7 Guardrails — `src/pipeline/guardrails.ts`

This is the **`beforeTool` hook**, a function the Cline SDK runs **before every tool
call**. If it returns `{ skip: true, reason }`, the tool never runs and the agent receives
the reason instead. It blocks:
- **Any write during Triage.**
- **Test-file edits during Fix.**
- **Writes outside the allowed folders** (e.g. the Reproducer outside `tests/`).
- **The locked reproduction test**, by path.
- **Protected files** from `patchpilot.config.json`: `server.js`, `package.json`, `.env`,
  and so on.
- **Dangerous shell commands:** `rm -rf`, `git push`, `git reset --hard`, `curl`, `wget`,
  `npm publish`, and others.

Every block is recorded in the incident and shown on the dashboard.

### 5.8 Hard checks — `src/pipeline/hardchecks.ts`

A second safety net that runs on the **diff** after each Fixer attempt, in case something
slipped past the hook:

| Check | Catches |
|---|---|
| `no-test-file-edits` | Any test file in the diff |
| `no-protected-path-edits` | Protected files in the diff |
| `diff-size-within-cap` / `diff-lines-within-cap` | Fixes that rewrite too much (cap: 3 files, 150 lines) |
| `no-skip-or-only-markers` | `.skip(`, `.only(`, `xit(`: switching tests off |
| `no-new-module-mocks` | `jest.mock` / `vi.mock`: faking the code under test |
| `no-equality-overrides` | `valueOf`, `toJSON`, `Symbol.toPrimitive`: making wrong values compare equal (an ImpossibleBench cheat) |
| `diff-not-empty` | "Fixes" that change nothing |
| `brace-balance` | Truncated or garbled edits |

### 5.9 Test runner — `src/pipeline/testrunner.ts`

Runs the project's test command inside the sandbox, with a 2-minute timeout, and turns the
output into a **short summary**: pass and fail counts plus only the lines about failures,
capped at about 3,500 characters. The model sees the useful part, not thousands of log
lines. It understands both Node's built-in test runner (`node --test`) output formats and
Jest/Vitest output.

### 5.10 Model wrapper, retries and timeouts — `src/pipeline/model.ts`

All agent calls go through one function, which:
- Creates the Cline SDK `Agent` with the chosen provider and model.
- **Retries when the provider is busy.** Messages like "high demand", "overloaded", 429,
  503 or quota errors trigger a wait (10, 20, then 30 seconds) and a fresh attempt. Up to
  3 retries.
- **Times out hung stages.** A stage that runs longer than 4 minutes is cancelled and
  retried. Some providers accept a request and never answer.
- **Falls back to a second model.** If `PATCHPILOT_FALLBACK_MODEL` is set, the last retry
  uses it instead.
- **Mock mode:** with `PATCHPILOT_MOCK=1`, it returns pre-written correct answers for the
  10 planted bugs instead of calling a model (see §5.15).

The retry, timeout and fallback were added after a real Gemini run failed with "This model
is currently experiencing high demand." A live demo can't depend on one busy model.

### 5.11 Cost tracking — `src/pipeline/cost.ts`

Every agent call reports how many tokens it used. PatchPilot converts that to dollars,
using real prices from the Cline SDK's model catalog (which covers Gemini, OpenAI and
others, with a built-in Claude price table as backup), then to rupees at ₹96 per dollar.
Each incident shows its total and a per-stage breakdown.

### 5.12 Orchestrator — `src/pipeline/orchestrator.ts`

The conductor. It runs: sandbox → Triage → (low confidence? escalate) → Reproducer →
Fixer up to 3 times → Critic → commit → PR. Every stage change is logged; any unexpected
error marks the incident `failed` with the error message instead of hanging.

### 5.13 PR builder — `src/pipeline/pr.ts`

Writes the PR in a structure based on what Sentry Seer, Copilot Autofix and OpenHands
produce:

```
## Fixes inc_… — TypeError: Cannot read properties of null …
**Root cause:** …            **Confidence:** triage 0.85 · review 0.85
### Evidence                 (suspect locations, route)
### Reproduction test        (file, name, "fails on main, passes here")
### Change summary
### Verification             (repro test, full suite, every hard check, critic)
### What the agent did not do / risk notes
### Provenance               (incident id, files changed, cost in ₹ and $)
A human reviews and merges this PR — PatchPilot never merges its own patches.
```

### 5.14 Dashboard — `dashboard/index.html`

One HTML file with no build step, served by PatchPilot at `http://localhost:4747`.
- **Left:** every incident, with a colored stage badge, occurrence count and ₹ cost.
- **Right:** the selected incident: a progress bar across the 8 stages, cost, tokens,
  duration and blocked-action count, the PR with its full text, every fix attempt with its
  hard-check ticks, every guardrail block, and the timeline.
- **Live:** it holds an open connection to `/api/stream` (Server-Sent Events). Every event
  appears the moment it happens, with no refresh. It reconnects automatically.

### 5.15 Mock mode — `src/pipeline/mockFixtures.ts`

With `PATCHPILOT_MOCK=1`, the agents use hand-written, checked answers for the 10 planted
bugs instead of calling an AI. **Everything else is real:** real git sandboxes, real file
edits through the real editor tool, real test runs, real hooks and hard checks, real
diffs and commits. It proves the *machinery* works and costs nothing. It does **not**
prove an AI can fix the bugs; that needs a real model run.

### 5.16 Demo app and the 10 bugs — `demo-app/`

A small Express shop with 11 API routes and 10 deliberately planted bugs, two in each of
five categories:

| # | Bug | Category | How it shows up |
|---|---|---|---|
| 01 | `computeTotal` reads `item.price` on a missing item | null/undefined access | Crash |
| 02 | `getUserCity` reads `user.address.city` with no address | null/undefined access | Crash |
| 03 | `parseDiscountPercent` uses `parseInt`, so 12.5% becomes 12% | wrong type conversion | Bug report |
| 04 | `calculateRefund` can't parse `"$19.99"` | wrong type conversion | Crash |
| 05 | `paginate` drops the last item of each page | off-by-one | Bug report |
| 06 | `chunk` skips one element between chunks | off-by-one | Bug report |
| 07 | `createUser` accepts an empty email | missing validation | Bug report |
| 08 | `updateEmail` stores the text `"undefined"` | missing validation | Bug report |
| 09 | Free shipping uses OR instead of AND | wrong condition | Bug report |
| 10 | `canCheckout` uses `.some` instead of `.every` | wrong condition | Bug report |

Seven are "bug report" bugs because in JavaScript a wrong condition or an off-by-one
**never throws**. They're filed as plain-English reports through
`/api/incidents/manual`, the way such bugs reach a team in real life.

The demo app has its own 14 normal tests, which all pass even with the bugs present,
because they test the normal cases. That's realistic: bugs survive precisely because no
test covers them.

### 5.17 Benchmark and hidden tests — `benchmark/`

`benchmark/golden/` holds **one hidden test per bug**, written by us and **never shown to
any agent**. This is the same idea as SWE-bench's hidden `FAIL_TO_PASS` tests. After
PatchPilot finishes a bug, the benchmark copies the hidden test into the sandbox and runs
it. Only if it passes does the bug count as fixed. That way the AI can't "pass" by writing
a weak test of its own.

`npm run bench` reports:

| Metric | Meaning |
|---|---|
| Fix rate | Bugs whose fix passes the hidden test |
| Reproduction rate | Bugs where the Reproducer's test truly failed before the fix |
| Escalation count | Bugs honestly handed to a human |
| Median time to PR | From crash to finished PR |
| Cost | Total and per-fix, in ₹ |
| Unsafe actions blocked | Guardrail blocks |

### 5.18 Unit tests — `tests/`

29 tests on PatchPilot's own logic: fingerprinting (line numbers ignored, overrides
honored), guardrails (each block rule, plus allowing legitimate edits), hard checks (each
cheat pattern), and test-output parsing.

---

## 6. The live servers and their endpoints

Two servers run during a demo.

### PatchPilot — `http://localhost:4747` (`npm start`)

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/incidents` | **Webhook.** Receives crash events from the middleware. Returns `201 created` for a new incident (and starts the pipeline), or `202 existing` for a repeat. |
| `POST` | `/api/incidents/manual` | **Bug reports.** Body: `{ "title", "description", "suspectFile"? }`. Same pipeline. |
| `GET` | `/api/incidents` | List of all incidents, newest first. |
| `GET` | `/api/incidents/:id` | One incident in full: triage, test, attempts, diff, PR, timeline, cost. |
| `GET` | `/api/config` | Configured repos and settings. |
| `GET` | `/api/stream` | **Live event stream (SSE)** that the dashboard listens to. |
| `GET` | `/` | The dashboard. |

You can show any of these working in a browser or with `curl`, e.g.
`curl http://localhost:4747/api/incidents`.

### Demo shop — `http://localhost:5050` (`npm run demo`)

| Method | Path | Uses |
|---|---|---|
| `POST` | `/api/orders/total` | `computeTotal` (bug 01) |
| `GET` | `/api/users/:id/city?user=…` | `getUserCity` (bug 02) |
| `POST` | `/api/orders/discount` | `applyDiscount` (bug 03) |
| `GET` | `/api/orders/refund?amount=&fee=` | `calculateRefund` (bug 04) |
| `GET` | `/api/catalog/page?items=&page=&size=` | `paginate` (bug 05) |
| `GET` | `/api/catalog/chunk?items=&size=` | `chunk` (bug 06) |
| `POST` | `/api/users/signup` | `createUser` (bug 07) |
| `POST` | `/api/users/:id/email` | `updateEmail` (bug 08) |
| `POST` | `/api/billing/eligibility` | free shipping (bug 09) |
| `POST` | `/api/billing/checkout` | `canCheckout` (bug 10) |
| `GET` | `/healthz` | `{"ok": true}` |

### How data flows

```
Browser/user ──► Demo shop :5050 ──crash──► middleware ──POST──► PatchPilot :4747
                                                                   │
                         ┌─────────────────────────────────────────┤
                         ▼                                         ▼
              .patchpilot/sandboxes/<id>  ◄── agents ──►  AI model (Gemini/Claude/…)
                         │                                         │
                         ▼                                         ▼
              commit on patchpilot/<id>          events ──SSE──► Dashboard (browser)
                         │
                         ▼
                  draft PR on GitHub (optional) ──► human merges
```

---

## 7. Exactly how the Cline SDK is used

This matters for the judging criterion "Effective use of Cline (bonus for the SDK)".
Precision helps here, so this lists exactly what is used.

**Packages** (version 0.0.88): `@cline/agents`, `@cline/llms`, `@cline/core`,
`@cline/shared`, `@cline/sdk`.

| SDK feature | Where | What for |
|---|---|---|
| `new Agent({ providerId, modelId, apiKey, systemPrompt, tools, maxIterations, hooks })` | `pipeline/model.ts` | Every agent: Triage, Reproducer, Fixer, Critic |
| `agent.run(prompt)` → `{ status, outputText, usage }` | `pipeline/model.ts` | Running each stage; usage feeds cost tracking |
| `agent.abort()` | `pipeline/model.ts` | Stage timeouts |
| **`hooks.beforeTool`** → `{ skip: true, reason }` | `pipeline/guardrails.ts` | **The guardrails**: blocks unsafe tool calls before they run |
| `hooks.onEvent` (tool-started, text deltas, status notices) | `agents/*.ts` | The live dashboard timeline |
| Custom tools (`name`, `description`, `inputSchema`, `execute`) | `pipeline/tools.ts`, `agents/*.ts` | `read_file`, `search_codebase`, `editor`, `run_test_file`, `run_repro_test`, `flag_for_human_intervention` |
| `@cline/llms` provider gateway | via `Agent` | Switch between Anthropic, Gemini, OpenAI-compatible, Ollama… with one `.env` line |
| `@cline/llms` `getModelsForProvider()` | `pipeline/cost.ts` | Real per-model prices for the ₹ cost |

**What is not used, so you don't overclaim:**
- Cline's built-in **team/subagent runtime** (`AgentTeamsRuntime` in `@cline/core`).
  PatchPilot runs its four agents through its own orchestrator.
- Cline's **file-based hooks** (`.clinerules/hooks/PreToolUse`) inside the product. Those
  are for your dev Cline (the dogfooding plan). The product uses the in-code `beforeTool`
  hook.
- The **Cline CLI's headless mode** (`cline -y --json`). PatchPilot calls the SDK
  directly.

**One SDK limit handled deliberately:** some providers (`claude-code`, `openai-codex-cli`)
run tools inside their own process, where `beforeTool` can't see them. PatchPilot refuses
those providers by default, because an unguarded run defeats the purpose.

**And remember:** this code was written with Claude Code, not Cline. For the "how your team
used Cline" part of judging, the work you do in Cline at the finale is what counts. See
[hackathon-plan.md](hackathon-plan.md).

---

## 8. Running it

All commands are PowerShell, from `D:\Desktop\Cline\patchpilot`.

**First time only:**
```powershell
cd D:\Desktop\Cline\patchpilot
npm install
Copy-Item .env.example .env     # then put your key in .env
```

**Quick checks:**
```powershell
npm run ci                                   # typecheck + 29 unit tests + demo-app tests
$env:PATCHPILOT_MOCK="1"; npm run bench      # all 10 bugs, mock mode, free
npm run bench -- 01                          # bug 01 only, real model from .env
```

**Live demo (three terminals, each starting with `cd D:\Desktop\Cline\patchpilot`):**
```powershell
npm start                 # terminal 1 — PatchPilot + dashboard (add $env:PATCHPILOT_MOCK="1"; first for mock)
npm run demo              # terminal 2 — demo shop
npm run demo:crash 01     # terminal 3 — fire bug 01 (omit 01 to fire all 10)
```
Then open **http://localhost:4747**.

**Clean slate** (stop PatchPilot first):
```powershell
Remove-Item -Recurse -Force .patchpilot; git worktree prune
git branch --list "patchpilot/*" | ForEach-Object { git branch -D $_.Trim() }
```

---

## 9. Configuration reference

### `.env` (your machine only; never committed)

| Setting | Example | Meaning |
|---|---|---|
| `PATCHPILOT_PROVIDER` | `gemini` | Which AI provider (`anthropic`, `gemini`, `openai-compatible`, `ollama`, …) |
| `PATCHPILOT_MODEL` | `gemini-3.5-flash` | Main model |
| `PATCHPILOT_FALLBACK_MODEL` | `gemini-3.8-flash` | Used if the main model stays busy after retries |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `PATCHPILOT_API_KEY` | | The key for your provider |
| `PATCHPILOT_MOCK` | `0` or `1` | `1` = pre-written answers, no model calls |
| `PATCHPILOT_OPEN_PR` | `0` or `1` | `1` = open a draft GitHub PR via `gh` |
| `PATCHPILOT_PORT` | `4747` | PatchPilot's port |
| `PATCHPILOT_INR_PER_USD` | `96` | Exchange rate for ₹ costs |
| `PATCHPILOT_STAGE_TIMEOUT_MS` | `240000` | Cancel and retry a stage after this long |

### `patchpilot.config.json`

```jsonc
{
  "defaultRepo": "demo-app",
  "maxFixAttempts": 3,            // Fixer attempts before escalating
  "minTriageConfidence": 0.35,    // below this, escalate instead of guessing
  "repos": {
    "demo-app": {
      "root": ".", "subdir": "demo-app",
      "testCommand": ["node", "--test"],
      "testPaths": ["tests"],      // Reproducer may write here; Fixer never
      "protectedPaths": ["server.js", "package.json", "package-lock.json", ".env", ".env.*"],
      "maxDiffLines": 150, "maxDiffFiles": 3,
      "baseRef": "HEAD"
    }
  }
}
```

To point PatchPilot at another project, add another entry under `repos`.

---

## 10. Results so far

### Mock mode (pre-written answers, everything else real)

| Metric | Result |
|---|---|
| Fix rate (hidden tests) | **10 / 10** |
| Reproduction rate | **10 / 10** |
| Unit tests | **29 / 29** passing |
| Demo app's own tests | **14 / 14** passing, before and after |

What this proves: the sandboxes, test runs, guardrails, hard checks, diffs, commits,
dashboard and benchmark all work together end to end. What it doesn't prove: that an AI
model can find and fix the bugs. The time (about 1.6 s) and cost (₹0.54) in mock mode are
**not meaningful**, because no model is called.

### Real model (Gemini)

**A real model has not yet finished a fix end to end.** Here is exactly what happened in
each run on 2 Oct, all on bug 01:

| Run | Model | What happened | What it taught us |
|---|---|---|---|
| 1 | `gemini-3.8-flash` | Triage was reading the right files (`total.js`, its test, `server.js`) when Google answered **"This model is currently experiencing high demand"**, and the run stopped. | Added retry with backoff, a per-stage timeout and a fallback model (§5.10). Switched the main model to `gemini-3.5-flash`, which was answering in about 1.5 s while `3.8-flash` took 26 s. |
| 2 | `gemini-3.5-flash` | **Triage:** correct root cause ("computeTotal … attempts to read item.price and item.quantity without checking if the item itself is null"). **Reproducer:** added a test that failed for the right reason (`Got unwanted exception (TypeError: Cannot read properties of null)`). **Fixer:** wrote a **correct** fix (wrap the line in `if (item) { … }`), but PatchPilot wrongly rejected it. | Found a real PatchPilot bug: the Reproducer's uncommitted test edit showed up in the Fixer's diff. Fixed by committing the test first (§5.4). About ₹9 had been spent when the run was stopped. |
| 3 | `gemini-3.5-flash` | Every request was refused: **"You exceeded your current quota, please check your plan and billing details."** The key's quota was used up by the earlier runs. | Quota and billing errors now fail immediately with a clear message instead of retrying (§5.10). |

What run 2 shows: on a real model, **Triage, Reproducer and Fixer each did their job
correctly**, and the one failure was a PatchPilot bug, now fixed. What's still missing is
a full run that ends in a PR, which needs a key with quota.

**To get real numbers:** use a key with available quota (enable billing on the Google AI
Studio project, wait for the free quota to reset, or use another provider), then run
`npm run bench -- 01` before trying all 10.

---

## 11. Limitations, stated honestly

| Limitation | Detail |
|---|---|
| **The sandbox isolates files, not the computer** | Git worktrees keep edits away from your real code, but the tests run as normal processes. For untrusted code, run it in a Docker container (on the roadmap; Docker isn't installed on the demo laptop yet). |
| **No queue** | Incidents run in the PatchPilot process. If it restarts mid-run, that incident is marked failed. A persistent queue (BullMQ + Redis) is on the roadmap. |
| **JavaScript/Node only** | The test runner and demo assume Node. Python and Go are roadmap items. |
| **PR creation is optional** | It needs `gh` installed, logged in, and a GitHub remote. Without that, the fix is still a commit on a branch in the sandbox. |
| **No guardrail fires in the current demo** | The mock answers and the 10 bugs never try anything unsafe. Bug #11 (a deliberately wrong test) is planned to show a live block. |
| **The real model may do worse than mock** | See §10. Only quote real-model numbers as real. |
| **Built with Claude Code, not Cline** | Matters for judging. See the hackathon plan. |
| **Dependency warnings** | `npm install` reports 31 vulnerabilities. All come through the Cline SDK's own dependencies (SAP provider, OpenTelemetry, `undici`), not PatchPilot's code. Don't run `npm audit fix --force`; it would likely break the SDK version. |

---

## 12. Questions you'll be asked

**"What stops the AI from cheating, like deleting the failing test?"**
Four layers. The `beforeTool` hook physically blocks test edits during Fix. The accepted
test is SHA-256 locked, and any change is detected. Hard checks scan every diff for test
edits, `.skip`, mocks and comparison tricks. And the full suite must pass, not just the
new test.

**"How do you know the fix is actually right?"**
The reproduction test failed before and passes after, the whole existing suite still
passes, an independent Critic reviews it, and a human merges. In the benchmark, a hidden
test the AI never saw grades every fix.

**"What if it can't fix the bug?"**
After 3 failed attempts, or low Triage confidence, or the Fixer flagging the test as
wrong, the incident goes to **Needs Human** with the reason. It never forces a fix.

**"Can it break my code?"**
No. All edits happen in a separate git worktree. Your working copy is never touched, and
nothing merges without a human.

**"Why not use Sentry Seer?"**
Seer is closed source, needs Sentry, and costs $40 per contributor per month. PatchPilot
is open source, self-hosted, works with any model, and enforces test-first.

**"Does it only handle crashes?"**
No. Bugs that never crash (wrong conditions, off-by-one) come in as plain-English reports
through `/api/incidents/manual`. Seven of the 10 demo bugs are like that.

**"Which AI model does it use?"**
Any provider the Cline SDK supports, chosen with one line in `.env`. It's currently set
up for Gemini, and it automatically retries and switches to a backup model if the main
one is overloaded.

**"How does it use Cline?"**
Answer from §7, and don't claim the parts listed as not used.

**"Is the Docker sandbox real?"**
Not yet. Per-incident git worktrees isolate the code; Docker, which would isolate the
operating system too, is on the roadmap.

**"What does a fix cost?"**
Quote the measured number from §10, not the mock figure.

**"Why are there 31 vulnerabilities?"**
They're in the Cline SDK's dependencies, not PatchPilot's code. We pin the SDK version.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Agent** | An AI model in a loop: it reads, calls tools (read a file, run a test), sees the results, and continues until done. |
| **Cline SDK** | Cline's open-source TypeScript toolkit for building agents. PatchPilot's agents run on it. |
| **Tool call** | When an agent asks to do something, e.g. "read this file". |
| **`beforeTool` hook** | A function that runs before every tool call and can block it. PatchPilot's guardrails. |
| **Stack trace** | The list of function calls active when the program crashed, from first to last. |
| **Fingerprint** | A short ID computed from a crash, used to recognize repeats of the same bug. |
| **Incident** | One bug as PatchPilot tracks it, with all its occurrences, agent work and results. |
| **Git worktree** | A second working copy of a git repository, on its own branch, in another folder. |
| **Diff** | The exact lines a change adds and removes. |
| **Pull request (PR)** | A proposed change on GitHub that a human reviews before merging. A draft PR is marked not ready yet. |
| **Reproduction test** | A test written to make the bug happen. It must fail before the fix and pass after. |
| **Fail-to-pass (F→P)** | A test that fails before the fix and passes after. The proof a fix works. |
| **Full test suite** | All of the project's tests, not just the new one. |
| **Hidden / golden test** | A test the AI never sees, used only to grade the result. |
| **Mock mode** | Running with pre-written answers instead of an AI, to test everything else at zero cost. |
| **SSE (Server-Sent Events)** | A simple browser connection the server keeps open to push live updates. |
| **Webhook** | A URL that another program calls to tell you something happened. |
| **Escalation / Needs Human** | PatchPilot giving up honestly and handing the bug to a person. |
| **Token** | The unit AI models count text in. Cost is based on tokens in and out. |
| **Provider / model** | The AI company (Gemini, Anthropic…) and the specific model (`gemini-3.5-flash`…). |
