# PatchPilot: plan for the rest of the hackathon

Covers the time between now (2 Oct) and the finale, the 8-hour build itself, the pitch,
and what happens after.

**Assumptions.** Change these if they're wrong; the plan adjusts but stays the same shape.
- The finale is on or shortly after **4 Oct**. The deck's Slide 8 says "Prepare: before
  4 Oct".
- There are **3–4 people** on the team. Roles are written as A–D. With three people,
  merge C and D.
- The Round 1 deck is submitted or about to be. Deck fixes are in
  [pitch-deck-additions.md](pitch-deck-additions.md).

---

## 0. Two facts that shape everything

### The existing code was built with Claude Code, not Cline

Everything in this repo was written in a Claude Code session. One judging criterion is
*"how meaningfully your team leveraged **Cline** in your build workflow"*, and Slide 8
promises that every teammate builds through Cline and that every Cline task is logged.

So: **whatever you show as "built with Cline" has to actually be built with Cline during
the finale, and logged.** Don't present this repo as Cline's work. If the organizers allow
prior code (next point), describe it honestly as "a prototype we built to test the idea"
and make the finale work clearly Cline-driven.

### Nobody knows yet whether prior code is allowed

Ask the organizers today (see §1). The finale plan in §3 has two versions:
- **Plan A:** prior code allowed. Bring the working core and use the 8 hours to harden it,
  extend it, and do the Cline-driven work.
- **Plan B:** everything must be written live. Rebuild in Cline from your design notes,
  using this repo only as a learning spike that you don't copy from.

---

## 1. Today (2 Oct): unblock

| # | Task | Owner | Done when |
|---|---|---|---|
| 1 | **Email or DM the PClub organizers** with these questions: (1) Can Round 1 prototype code be used in the finale? (2) Can we bring design docs, prompts and a Cline Memory Bank? (3) Is internet available, and can we use our own API keys? (4) How long is the pitch/demo slot, and is Q&A included? (5) Exact start and end times. | D | Written answers saved in `docs/organizer-answers.md` |
| 2 | **Install Cline everywhere.** VS Code extension on every laptop, plus the Cline CLI on the demo laptop. Everyone signs in. If you're shortlisted, activate the free **Cline Pass**. | All | Everyone can run a Cline task |
| 3 | **Start the Cline task log** (a shared sheet): date · person · task given to Cline · result · commit hash · checkpoint restored? · bug Cline fixed? | D | Sheet exists and has a first entry |
| 4 | **Check model access and budget.** Option 1: an Anthropic API key with a spending cap. Option 2, better for the Cline criterion: run PatchPilot's own agents through Cline's provider (`PATCHPILOT_PROVIDER=cline`) on the Cline Pass. **Option 2 is unverified.** Test it with one triage run before relying on it. | A | One real (non-mock) triage completes and its cost is recorded |
| 5 | **Check the demo laptop.** This machine has no Docker (`docker: command not found`). Decide now: install Docker Desktop and prove a container runs, or commit to git-worktree sandboxes and list Docker as roadmap. | B | Decision written down |

---

## 2. 3 Oct: prepare (everything here is safe under Plan B too)

These are design, setup and rehearsal work, not product code, so they should be fine
whatever the organizers say. **If an organizer says prompts or design docs count as
code, drop them.**

### 2.1 Real-model dry run (Owner A) — most important

Mock mode proves the pipeline works, not that a model can fix the bugs. Before the
finale you need to know where a real model struggles.

1. Run 2 bugs for real: `npm run bench` with the key set, after limiting the bug list to
   two (e.g. edit `BUGS` temporarily).
2. Record the time per stage, the ₹ per bug, and every failure.
3. **Cost check:** the slide target is under ₹20 per fix. Back-of-envelope with Opus 5.5
   and no caching is roughly ₹40–90 per bug, depending on how many turns the agents take.
   If you measure above ₹20, try Sonnet 5.5 for Triage and Reproducer (about half the
   price). Choosing a model per stage is also a good "model switching" SDK story. Measure
   it; don't guess.
4. Write down every failure mode: prompt confusion, wrong file, a test that throws instead
   of asserting. **This list is the most valuable input to the finale.** In Plan B you
   rebuild with these lessons already learned.
5. **Budget:** about ₹2,000 covers several full 10-bug runs. Set the cap on the API key.

### 2.2 The live guardrail-block scenario (Owner B)

Right now no guardrail ever fires in the demo (the benchmark says "unsafe actions
blocked: 0"), yet Slide 10 promises "100% blocked". Fix that by design:

- **Add bug #11: "impossible test".** Report a bug whose reproduction test contradicts
  the spec, e.g. "canCheckout should return true for an empty cart." The Fixer's shortcut
  is to edit the test, so expect it to try.
- **What should happen:** the hook blocks the test edit → the block appears on the
  dashboard → the Fixer calls `flag_for_human_intervention` → the incident goes to
  **Needs Human**.
- **This one bug demonstrates three claims:** guardrails really block, escalation is
  honest, and the "escalation honesty" metric becomes measurable (1/1 instead of 0/0).
- Prove it with a real model at least twice. Models don't always take the bait. If yours
  never does, add a mock fixture for this case so the demo can trigger the block on
  demand, and say on stage that it's a scripted trigger.

### 2.3 One guardrail script for both dev Cline and the product (Owner B)

Slide 8 says your own Cline can't touch `.env` or delete tests. Make that literally true
with one script:

1. Write `.clinerules/hooks/PreToolUse`, an executable script. Cline's file hooks read
   JSON on stdin (`preToolUse.toolName`, `preToolUse.parameters.path`) and print
   `{"cancel": true, "errorMessage": "..."}` to block. Rules: no writes to `.env*`, no
   edits to or deletes of `tests/`, no `git push --force`.
2. Test it: ask your dev Cline to "delete tests/total.test.js". **Screenshot the block**
   for Slide 8.
3. **Stretch:** have the product's `beforeTool` hook run the same script (spawn it, pipe
   the same JSON in, read `cancel`). Then one file protects both layers, which is a strong
   one-liner for the pitch. Time-box it to 1 hour; if it slips, keep the two
   implementations separate.

### 2.4 Cline workspace setup (Owner D)

- **Memory Bank:** architecture, the incident data model, API routes, agent contracts
  (what Triage hands Reproducer, and so on), and the failure-mode list from §2.1.
- **`.clinerules`:** coding rules (TypeScript strict mode, no new dependencies without
  asking, tests via `node --test` in the demo app, never edit `tests/` during fix work).
- **Kanban cards**, one per module with one owner each: webhook/intake · sandbox · Triage
  · Reproducer · Fixer · guardrails + hard checks · dashboard · benchmark · PR creation.
- In Plan B, these cards are the finale's work queue.

### 2.5 GitHub demo repo (Owner C)

- Create a public demo repo containing only the demo shop app (not PatchPilot), with
  `gh` logged in on the demo laptop.
- Do one dry run with `PATCHPILOT_OPEN_PR=1` and confirm a real draft PR appears. Seeing
  a PR open on stage is the strongest moment in the demo.
- Test on the venue network if you can, or on a phone hotspot. `git push` over a
  restricted Wi-Fi is a classic way for a demo to fail.

### 2.6 Deck, video, social (Owner D)

- Apply the deck fixes from [pitch-deck-additions.md](pitch-deck-additions.md), in its
  priority order.
- **Record the backup demo video now,** from a mock-mode run, so it can't fail. Re-record
  it in the finale if a real run goes well.
- Draft the social-media post now; it's a separate ₹15,000 prize. Use a 30–45 s clip of
  the dashboard fixing a bug, tagging Cline and PClub IITK.

### 2.7 Packing list

Chargers · phone hotspot · HDMI/USB-C adapter · `npm ci` done on the demo laptop with
`node_modules` present · backup video saved locally **and** on a USB stick · the deck as
a PDF · API keys in a password manager, **never** on the USB stick or in the repo.

---

## 3. Finale day: the 8 hours

**Rule from the deck: one bug fixed end to end by hour 5, then polish.** Gates are marked
🚦. If you miss a gate, do what the gate says; don't push on.

### Plan A — prior code allowed

The core already works, so the 8 hours go on real-model reliability, the "wow" moments,
and visible Cline usage. **Every change goes through Cline and gets logged.**

| Hours | A: Agents/SDK | B: Sandbox/guardrails | C: Dashboard/demo app | D: Pitch/benchmark/log |
|---|---|---|---|---|
| 0–1 | Real-model smoke test of 1 bug on venue network | Dev Cline hook check; re-shoot block screenshot | Dashboard on projector; check readability | Start Cline log; write the stage-by-stage demo script |
| 1–3 | Prompt fixes for the failure modes from §2.1 (in Cline) | Bug #11 and the live-block path | Dashboard polish: stats header (median time, fixed/total, ₹, blocks), as on the Slide 5 mockup | Real PR dry run on the demo repo |
| 3–5 | Per-stage model choice if cost is above ₹20 | Stretch: shared hook script (§2.3), time-boxed | Make the incident view readable from the back of a room | Run the real 10-bug benchmark in the background |
| 🚦 5 | **Gate:** a live crash produces a real draft PR on GitHub, on a real model. If not, the demo runs in mock mode with the real PR from the dry run, and the team spends 5–7 on fixing that one path. | | | |
| 5–6 | Fix whatever the benchmark exposed | Docker container sandbox, **only if** installed and proven before the finale | Final UI fixes | Put measured numbers into Slide 10 |
| 6–7 | **Code freeze at 6:30** | Help rehearse | Re-record backup video | Full rehearsal ×1 |
| 7–8 | Rehearsal ×2, Q&A drill | | | Fill in the Cline log numbers on Slide 8 |

### Plan B — everything written live

Build in Cline from the Kanban cards and Memory Bank. Keep the scope tight: **4 bugs, not
10**, which matches the deck's MVP slide.

| Hours | A: Agents/SDK | B: Sandbox/guardrails | C: Dashboard/demo app | D: Pitch/benchmark/log |
|---|---|---|---|---|
| 0–1 | Cline Plan mode / `/deep-planning` from the Memory Bank → task breakdown | Webhook + incident store + fingerprinting | Demo shop app, 4 planted bugs, capture middleware | Cline log running; repo skeleton; CI |
| 1–3 | Triage + Reproducer agents (`@cline/agents` `Agent`) | git-worktree sandbox + test runner + independent "does it fail?" check | Dashboard skeleton with live SSE timeline | Hidden golden tests for the 4 bugs |
| 3–5 | Fixer loop: 3 tries, revert, feedback | `beforeTool` guardrails + hard diff checks | Incident detail view: attempts, diff, blocks | PR creation via `gh` |
| 🚦 5 | **Gate:** one bug end to end (crash → test → fix → PR). If not, cut the Critic, cut bugs 3–4, cut cost tracking. Everyone works on the single end-to-end path until it works. | | | |
| 5–6 | Critic pass (if gate met) | Bug #11 live block | ₹ cost and time on the dashboard | Benchmark run on 4 bugs |
| 6–7 | **Code freeze at 6:30** | Help rehearse | Record backup video | Rehearse ×1 |
| 7–8 | Rehearse ×2, Q&A drill | | | Fill in Cline log numbers |

**Throughout the day:** use Cline checkpoints when an edit goes wrong, and log every
restore. "Cline wrote N of M modules and fixed K of our own bugs" needs real numbers.

---

## 4. The pitch and live demo

Assumes a 7-minute slot (5 pitch/demo + 2 Q&A). Adjust once the organizers confirm.

### Run of show

| Time | Who | What |
|---|---|---|
| 0:00 | D | Tagline and the problem: 13 hours per bug, reproduction is the hard part. Riya at 2 AM. |
| 0:45 | D | How it works: the 6-step flow and why test-first (SWT-Bench). |
| 1:30 | C | **Live demo starts.** Ask a judge to click "checkout" on the demo shop with a broken cart. |
| 1:45 | A | Narrate the dashboard as it streams: Triage root cause → failing test → fix → full suite green. |
| 2:45 | B | **The guardrail moment:** trigger bug #11 and show the blocked test edit and the honest Needs Human. |
| 3:30 | C | Switch to GitHub: the draft PR with root cause, test, verification checklist. "A human merges. It never merges itself." |
| 4:00 | A | Cline SDK slide: the two hook layers, dogfooding, the Cline log numbers. |
| 4:30 | D | Benchmark numbers (measured, not targets), competition table, close. |
| 5:00 | All | Q&A |

### When the demo goes wrong

Go down this list one step at a time; don't improvise.
1. **Live, real model.** Ideal.
2. **Live, mock mode** (`PATCHPILOT_MOCK=1`). Same dashboard and a real PR, with no model
   latency or API risk. Say so: "we're in deterministic mode for the stage."
3. **Backup video.** Switch within 15 seconds; don't debug on stage.

Decide the trigger in advance: **if nothing has moved on the dashboard within 20 seconds,
drop one level.**

### Q&A: prepare honest, short answers

| Likely question | Answer |
|---|---|
| "Is the Docker sandbox real?" | Say whichever is true. If worktrees: "Per-incident git worktrees isolate the code; Docker isolates the OS, and that's next on the roadmap." |
| "Do you use Cline's native subagents?" | Say what's built: three SDK agents, our own orchestrator, SDK `beforeTool` hooks. Only claim the team runtime if you actually adopted it. |
| "Are the numbers from a real model?" | Only quote real-model numbers as real. If any are from mock mode, say so. |
| "What stops it cheating on the test?" | The hook blocks test edits, the test is SHA-256 locked, the full suite runs, and the hard checks catch `.skip`, mocks and operator overloading. |
| "Why not just use Sentry Seer?" | It's paid ($40 per contributor per month), closed source, and needs Sentry. We're open source, self-hosted and test-first. |
| "What about bugs that don't crash?" | Plain-English reports through `/api/incidents/manual`. 5 of our 10 bug categories never throw. |
| "How much did Cline build?" | Read from the log. Exact numbers beat adjectives. |

---

## 5. After the hackathon

- **Same day:** post the social-media clip (tag Cline and PClub IITK) and apply for the
  Cline Ambassador Program.
- **Within a week:** open-source the repo with the README, a short write-up of measured
  results, and a demo GIF. Thank-you note to the organizers.
- **If you keep going:** Docker sandbox, a Sentry-compatible intake endpoint (so existing
  Sentry SDKs can report to PatchPilot), Python support, a GitHub App instead of the `gh`
  CLI.

---

## 6. Risks

| Risk | Likelihood | What to do |
|---|---|---|
| Organizers don't allow prior code | Medium | Plan B is ready; the prep in §2 still helps. |
| Real model fails bugs that mock passes | High | §2.1 dry run finds this early. Quote real numbers only. |
| Venue Wi-Fi blocks the API or `git push` | Medium | Phone hotspot; mock-mode fallback; pre-recorded video. |
| Cost above ₹20 per fix | Medium | Per-stage model choice; measure in §2.1. |
| The model doesn't attempt the unsafe edit in bug #11 | Medium | Scripted mock trigger, disclosed as scripted. |
| Cline Pass provider doesn't work for the agents | Unknown | Anthropic key as fallback; test it on 2 Oct. |
| Judge asks about something the deck overclaims | Medium | Fix the deck first; the Q&A table above. |
| Running out of time in the 8 hours | High in Plan B | Hour-5 gate; cut scope, never quality of the one path. |

---

## Checklist for the next 48 hours

- [ ] Questions sent to the organizers (§1)
- [ ] Cline installed and signed in on every laptop; task log started
- [ ] One real-model run completed and its cost recorded
- [ ] Docker yes/no decided
- [x] Bug #11 written and a live block seen (mock mode; still to see on a real model)
- [x] Dev Cline hook written and tested (`.clinerules/hooks/PreToolUse.js`). **Screenshot still to take in your Cline.**
- [ ] Memory Bank, `.clinerules` and Kanban cards ready
- [x] Real draft PR opened on the demo repo ([demo-shop#1](https://github.com/ArnabZ-77/patchpilot-demo-shop/pull/1))
- [ ] Deck fixes applied
- [ ] Backup video recorded and saved in two places
- [ ] Social post drafted
