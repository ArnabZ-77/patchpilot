# PatchPilot deck: what to add, slide by slide

This reviews the 10-slide Round 1 deck against two things: the hackathon's five judging
criteria, and the working PatchPilot build in this repo. The deck was written before the
code existed. A few slides now describe things differently from how they were actually
built, and those mismatches are the most important fixes here.

**Judging criteria, for reference:** Innovation & Originality · Real-World Usefulness ·
Effective Use of Cline (bonus for the SDK) · Usability & Execution · Technical
Implementation.

---

## Decide these first

These three questions change what goes on several slides.

### 1. Can Round 1 code be carried into the Stage 2 finale?

You have a working build: 10/10 planted bugs fixed in mock mode, 29 unit tests, and a live
dashboard. Many hackathons only allow code written during the live sprint. The rules you
pasted don't say either way.

**Action:** ask the PClub organizers before you change Slide 9. Their answer decides
whether Slide 9 says "we build this in 8 hours" or "we arrive with a proven core and use
the 8 hours to harden and extend it." Don't guess.

### 2. Should Slide 6 show the planned architecture or the built one?

| Slide 6 says | What's actually built | Note |
|---|---|---|
| Docker sandbox per incident | `git worktree` per incident | Isolates files but not the OS. Docker is still the right target for untrusted code. |
| BullMQ + Redis queue | In-process async pipeline with an in-flight set | Fine for a demo, but has no retry or persistence across restarts. |
| React + WebSocket dashboard | Single HTML file with Server-Sent Events | Works today and needs no build step. |
| Octokit GitHub PR | `gh pr create --draft` | Same result with less code, but needs `gh` installed and logged in. |

Either answer is fine. The risk is a judge asking "show me the Docker sandbox" when there
isn't one. Pick one of these:

- **(a)** Show the built architecture now and label Docker/BullMQ as "Stage 2 hardening."
  Lower risk.
- **(b)** Keep the planned architecture, but only if you will really build Docker and
  BullMQ in the 8 hours. That is hard in 8 hours on top of everything else.

**Recommendation: (a).** A working simpler design that you can explain honestly is worth
more than a diagram you can't demo.

### 3. Slide 7 claims Cline SDK features the build doesn't use

- **"Native handoff notes, no extra orchestrator."** The build uses its own TypeScript
  orchestrator (`src/pipeline/orchestrator.ts`). It calls three separate `Agent` instances
  from `@cline/agents` one after another. It does not use Cline's team runtime
  (`AgentTeamsRuntime` / `bootstrapAgentTeams` in `@cline/core`).
- **The hook sketch shows a different hook layer from the one the product uses.**
  `input.preToolUse.toolName` / `parameters.path` and the `{cancel, errorMessage}` return
  are correct for Cline's **file hooks**: scripts in `.clinerules/hooks/` or
  `~/.cline/hooks/` that your own Cline editor and CLI run. That is exactly the
  dogfooding story on Slide 8. The product itself uses the SDK's in-process `beforeTool`
  hook, which takes `{ tool, toolCall, input }` and returns `{ skip: true, reason }`.
  Show both and label which is which (snippet under Slide 7 below). Better still, make
  the product call the same hook script, so one guardrail file protects both your dev
  Cline and PatchPilot (see the hackathon plan).
- **"CLI headless mode (`cline -y --json`)."** The build doesn't use it. It calls the SDK
  directly from Node, which is the stronger SDK story anyway.

"Effective Use of Cline, bonus for the SDK" is an explicit criterion, so this slide matters
most. You can fix it in either of two ways:

- **(a) Correct the wording** to say what's built: three SDK agents, a custom orchestrator,
  and real `beforeTool` hooks. This is accurate and still uses the SDK properly.
- **(b) Move the orchestration onto `@cline/core`'s team runtime** in Stage 2 so the
  "native" claim becomes true. This earns more SDK credit but is extra work. Prototype it
  before promising it.

---

## Slide 1: Title

**Keep:** the tagline "Your app breaks at 2 AM. A tested fix is waiting for you at 2:05."
It's strong.

**Add:**
- Team name and member names, with one line each on role (e.g. "Agents & SDK",
  "Dashboard", "Demo app & benchmark").
- A QR code or short link to the GitHub repo, if the organizers allow sharing code.
- A one-line proof point under the tagline, e.g. *"Working prototype: 10/10 planted bugs
  fixed end to end."* Only use it if issue 1 above allows referring to Round 1 code. Add
  "(mock mode)" until you have a real-model run (see Slide 10).

---

## Slide 2: Problem

**Keep:** the three stat cards and the "Why now" box. They're well sourced.

**Add:**
- **Put the problem in rupees.** "13 hours × a typical Bangalore backend developer's hourly
  cost ≈ ₹X per bug." A number in rupees lands harder with Indian judges than hours alone.
  Use a salary figure you can defend.
- **One line linking this to PatchPilot's design:** *"41% say reproduction is the hardest
  step, so it's the first thing PatchPilot automates."* The dossier says to lead with
  reproduction, and this slide is where that argument starts.
- **Optional:** a quote from one or two real developers (classmates, a startup you know).
  Even an informal one makes the pain concrete.

**Fix:** none.

---

## Slide 3: Market and persona

**Keep:** the four segments and Riya. The persona is specific and believable.

**Add:**
- **A rough market size.** For example, the number of early-stage Indian startups or
  indie SaaS products with no dedicated SRE, citing NASSCOM, Tracxn or similar. A
  bottom-up estimate is fine if you label it as one.
- **Why India specifically, in one line.** SRE salaries are out of reach for seed-stage
  teams, and Sentry Seer costs **$40 per active contributor per month**. That's a real
  price you can quote as the comparison.
- **Riya's 2 AM in one sentence.** *"Riya's pager goes off → PatchPilot has a tested PR
  waiting when she opens her laptop."* This ties the persona back to the tagline.

**Fix:** none.

---

## Slide 4: How it works

**Keep:** the six-step flow and the value-proposition box.

**Add:**
- **One real example, start to finish, under the flow.** Use an actual planted bug from
  the build, e.g. Bug #1 `computeTotal`:
  - **Crash:** `TypeError: Cannot read properties of null (reading 'price')`
  - **Triage:** "computeTotal reads `item.price` without checking the item is defined"
  - **Reproduce:** a test that passes `[item, null, item]` and fails
  - **Fix:** `+ if (!item) continue;` (one line)
  - **Proof:** the test fails before the fix and passes after; the full suite stays green
- **The two safety nets the flow doesn't show:** *"Up to 3 fix attempts, then honest
  escalation to Needs Human"* and *"An independent Critic reviews the diff before the PR
  opens."* Both are built. The Critic is modelled on DeepMind CodeMender's critique step,
  which is worth naming as an originality point.
- **Intake for bugs that don't crash:** a wrong `if` or an off-by-one never throws in
  JavaScript. The build accepts plain-English bug reports through
  `/api/incidents/manual`, so it handles more than crashes. One line covers it.

**Fix:** "research shows this doubles fix precision" is accurate (SWT-Bench). Add the
caveat: *"at the cost of lower recall: it keeps fewer patches, but the ones it keeps are
right more often."* A judge who knows the paper will respect it.

---

## Slide 5: Core features and dashboard

**Biggest single improvement in the deck: replace the mockup with a real screenshot.**
The slide says *"Illustrative mockup; values are sample data."* A working dashboard now
exists at `localhost:4747`.

**Do this:**
1. `PATCHPILOT_MOCK=1 npm start` + `npm run demo` + `PATCHPILOT_MOCK=1 npm run demo:crash`
2. Screenshot the dashboard with an incident selected that shows a completed PR and the
   timeline.
3. Replace the mockup, and change the caption to *"Live dashboard from our working
   prototype."* Keep "mock mode" in the caption until you have a real-model screenshot.

**Add:**
- If you keep a mockup anywhere, make its numbers believable. The mockup shows "4 / 5
  auto-fixed", which is fine as sample data, but don't let it contradict what's on Slide 10.
- **"Cost per fix in ₹" is built**, and the dashboard shows it per incident.

**Fix — check each claim against the build:**

| Feature on slide | Built? |
|---|---|
| Test-first proof | ✅ Yes. The test must fail independently before any fix is accepted. |
| Enforced guardrails | ✅ Yes. `beforeTool` hooks block test edits, protected paths, and destructive commands. |
| Live agent timeline | ✅ Yes, over SSE. |
| Honest escalation | ✅ Yes. Low triage confidence or 3 failed attempts → Needs Human. |
| Cost per fix in ₹ | ✅ Yes. |
| Self-hostable, any model | ✅ Yes. Any `@cline/llms` provider through `.env`. |

All six check out.

---

## Slide 6: Technical architecture

See [issue 2](#2-should-slide-6-show-the-planned-architecture-or-the-built-one). If you go
with option (a), redraw it like this:

```
Target app (Express + capture middleware)
        │ POST /api/incidents  (or /manual for non-crash bugs)
        ▼
PatchPilot server (Express, fingerprint dedup)
        │
        ▼
git worktree sandbox per incident ── [Stage 2: Docker container]
  ├─ Triage agent     (read & search only)
  ├─ Reproducer agent (writes tests/ only, test then locked by hash)
  ├─ Fixer agent      (edits src only, ≤3 attempts, auto-revert on failure)
  └─ Critic agent     (sees only the diff, can't edit)
  ── beforeTool hook on every tool call ──
        │                         │
        ▼                         ▼
Live dashboard (SSE)        Draft PR (gh CLI) → human merges
```

**Add:**
- **The Critic** as a fourth agent box. It's built and missing from the diagram.
- **The fallback layer under the hooks:** "Hard diff checks after every attempt: size
  caps, no `.skip`, no new mocks, no `valueOf` overrides." This is a second safety net in
  case the hook misses something, and it's a good engineering-maturity signal.
- **"Labelled 'Stage 2'"** on anything not yet built (Docker, queue).

**Fix the tech-stack table to match the build:**

| Layer | Built | Stage 2 option |
|---|---|---|
| Agent runtime | `@cline/agents` 0.0.88, Node 22+, TypeScript | `@cline/core` team runtime |
| Models | Any `@cline/llms` provider (default Claude Opus 5.5) | — |
| Backend | Node.js + Express 5 | — |
| Queue | In-process | BullMQ + Redis |
| Sandbox | git worktree, LF line endings forced | Docker per incident |
| PR | `gh pr create --draft` | Octokit |
| Frontend | Plain HTML + SSE, no build step | React + Tailwind |

---

## Slide 7: Cline SDK as the engine

See [issue 3](#3-slide-7-claims-cline-sdk-features-the-build-doesnt-use). This slide
carries the bonus criterion, so make it the most precise slide in the deck.

**Keep the sketch, label it "Dev Cline file hook (`.clinerules/hooks/PreToolUse`)", and put
the product's real SDK hook next to it** (simplified from `src/pipeline/guardrails.ts`):

```ts
import { Agent } from "@cline/agents";

const fixer = new Agent({
  providerId: "anthropic",
  modelId: "claude-opus-5-5",
  systemPrompt: FIXER_PROMPT,
  tools: [readFile, search, editor, runReproTest, flagForHuman],
  hooks: {
    beforeTool({ tool, input }) {
      const path = input?.path ?? "";
      if (tool.name === "editor" && path.startsWith("tests/")) {
        return { skip: true, reason: "GUARDRAIL: Fixer may not modify tests" };
      }
      return undefined; // allow
    },
  },
});
fixer.subscribe((event) => pushToDashboard(incidentId, event)); // live timeline
```

The two together show that the same rule is enforced at both layers: on your dev Cline
and inside the product.

**Change the four feature blocks to match the build:**
- **Powers the product:** "Three `@cline/agents` Agents (plus a Critic), each with its own
  system prompt and tool list, run in sequence by our orchestrator." Only say "native
  subagent handoffs" if you take option (b) from issue 3.
- **Enforces safety:** keep the text, and say "PreToolUse file hook (dev) + `beforeTool`
  hook (product)". Add:
  *"The accepted reproduction test is SHA-256 locked; changing it is blocked and detected."*
- **Audits every step:** `agent.subscribe()` events feed the live timeline and the cost
  tracking. Accurate as written.
- **Runs headless:** change to *"Runs headlessly from a webhook through the SDK; switch
  models with one `.env` line (`PATCHPILOT_PROVIDER` / `PATCHPILOT_MODEL`)."* Remove
  `cline -y --json` unless you add it.

**Add — something judges may not expect:** *"We refuse to run on providers whose tools run
inside their own process (e.g. claude-code, codex-cli), because our hook can't see those
calls."* This shows you understand the SDK's limits, not just its features.

---

## Slide 8: How we build with Cline

**Keep:** the five phases and the "we dogfood our own product" box. That box is
original and on-criterion.

**Add:**
- **A metrics row you fill in after the sprint:** "Cline tasks: __ · Cline commits: __ ·
  bugs Cline fixed in our own code: __ · checkpoints restored: __". The dossier says to
  log these and show them. **Start the log now.**
- **Proof of dogfooding:** commit the hook config to the repo (e.g. `.clinerules/hooks/`)
  and put a screenshot of your dev Cline being blocked from editing `.env` on this slide.

**Fix:**
- **`npx skills add cline/sdk-skill`:** check this exists before the pitch. It came from
  the research dossier and nobody has confirmed it. If it doesn't exist, use what you
  actually used, such as the `@cline/agents` README and type definitions.
- **"Before 4 Oct":** make sure the date matches the official schedule.

---

## Slide 9: MVP scope and hour plan

Depends on [issue 1](#1-can-round-1-code-be-carried-into-the-stage-2-finale).

**If carrying Round 1 code is not allowed:** keep the plan. Two changes help:
- **Start with 10 bugs instead of 4.** The planted-bug pattern is already designed (two
  per category across five categories). The categories are null access, wrong type
  conversion, off-by-one, missing validation and wrong condition.
- **Put a working benchmark harness in hours 5–6,** not just "metrics." A runner that
  grades every bug against hidden tests is what produces the Slide 10 numbers.

**If carrying is allowed:** rewrite the plan to show you're starting from a working core:

| Hours | Plan |
|---|---|
| 0–1 | Real API key, one live bug end to end, record the backup video first |
| 1–3 | Docker sandbox (or explain why worktrees are enough) |
| 3–5 | Real GitHub PR from a live crash; dashboard polish |
| 5–6 | Live guardrail block demo (see below) |
| 6–7 | Real-model benchmark run for Slide 10 numbers |
| 7–8 | Code freeze, rehearse twice |

**Add in both cases — a planned live guardrail block.** Right now no guardrail fires in
the demo, because the mock fixtures behave themselves (the benchmark reports "unsafe
actions blocked: 0"). Slide 10 promises "100% unsafe actions blocked", so you need one
scenario that triggers a block on purpose. For example, a planted bug whose obvious "fix"
is editing the test. Without this, the claim can't be shown live.

---

## Slide 10: Competition and targets

**Keep:** the comparison table and the closing line.

**Fix the table:**
- **Sentry Seer → Self-host: "No."** Correct: the Seer repo is no longer public, and Seer
  isn't compatible with self-hosted Sentry.
- **Add a "Price" column.** Seer is **$40 per active contributor per month**; Copilot
  Autofix needs GitHub Advanced Security; PatchPilot is free, open source, and you pay
  only your own model costs. Price is the main advantage for your market.
- **Add a "Guardrails enforced in code" column.** Only PatchPilot has hook-level blocking
  plus the anti-cheating checks from ImpossibleBench. That's the originality story in one
  column.

**Targets vs. measured results — be careful here:**

| Target on slide | What you have now | What to do |
|---|---|---|
| 8/10 fixed | **10/10 in mock mode** | Mock mode uses hand-written fixtures, so it shows the *pipeline* works, not that a *model* does. Run `npm run bench` with a real API key before quoting a fix rate. |
| < 3 min median | ~1.6 s in mock | Meaningless: there are no real model calls. Real runs will take minutes. |
| < ₹20 per fix | ₹0.54 in mock | Also meaningless: mock records fixed fake token counts. The real figure comes from the real run. |
| 100% unsafe actions blocked | 0 blocks attempted | A target nothing has tested yet. You need the planned block from Slide 9. Better wording: "100% of attempted unsafe actions blocked (N/N)". |

**Add:**
- **Results from a real-model run**, once you have them, replacing the targets. Even
  "7/10 on our hidden tests" from a real model beats "8/10 target." Measured numbers carry
  more weight than goals.
- **Your strongest research claim in one line:** *"We run the full test suite, not just
  the new test. Research found about 30% of 'passing' agent patches behave differently
  from the human fix (PatchDiff, ICSE 2026)."* This shows you read beyond SWT-Bench.

---

## New slides to consider

Add these if you have room. Most hackathon decks run 10–14 slides.

### A. Team (after Slide 1 or before the close)
Names, photos, one line each on what they own. Judges score teams as well as ideas.

### B. Live demo plan (before Slide 10)
What the judges will see, step by step:
1. A judge triggers a crash on the live demo shop (e.g. checkout with an empty cart line).
2. The dashboard picks it up within seconds.
3. Triage, Reproduce, Fix and Critic each appear on the live timeline.
4. A guardrail block appears, from the Slide 9 scenario.
5. A draft PR opens on GitHub with the failing-then-passing test.
6. **Backup:** a pre-recorded video if the Wi-Fi or API fails.

### C. Risks and mitigations
Shows engineering maturity, which scores under Technical Implementation.

| Risk | Mitigation (built) |
|---|---|
| Agent edits the test to "pass" | Hook blocks it and the test is hash-locked |
| Plausible but wrong patch | Full suite + independent Critic + human always merges |
| Agent loops forever | Iteration caps per stage, at most 3 attempts, then escalation |
| Bad edit damages the repo | Every incident runs in a throwaway worktree; failed attempts auto-revert |
| Destructive shell command | Regex-blocked before it runs |
| Code sent to a third party | Self-host with any model, including local ones through `@cline/llms` |

### D. Roadmap after the hackathon
- Docker sandbox and a persistent queue
- Python and Go support (today it's Node only)
- A GitHub App instead of the `gh` CLI
- Sentry-compatible intake so existing Sentry SDKs can point at PatchPilot
- Open-source release, and the Cline Ambassador Program

### E. Close / ask
One line on what you want: feedback, beta users from the audience, GitHub stars. End on
the tagline again.

---

## Outside the deck

- **Social media track (₹15,000 extra):** plan a short screen recording of the live
  dashboard fixing a bug. Post it on X or LinkedIn tagging Cline and PClub IITK. The
  recording can double as the backup demo video.
- **README and repo polish:** judges may open the repo. The README is current and the
  repo is clean, so keep it that way.
- **Rehearse the Q&A answers** to "Is the Docker sandbox real?", "Do you use Cline's
  subagents natively?" and "Are those benchmark numbers from a real model?" Have honest,
  short answers ready. These are the three places the deck and the build currently
  differ.

---

## Priority order

If time is short, do these first:

1. **Ask the organizers** whether Round 1 code can carry over (issue 1)
2. **Fix Slide 7's claims and label its two hook layers** — the bonus criterion depends on it
3. **Replace Slide 5's mockup** with a real screenshot
4. **Align Slide 6** with the built architecture, or label the Stage 2 parts
5. **Run a real-model benchmark** and update Slide 10 with measured numbers
6. **Plan a live guardrail block** for the demo
7. Add the Team, Demo plan and Risks slides
