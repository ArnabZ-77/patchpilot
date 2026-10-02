# PatchPilot demo script: proving it fixes bugs

The proof judges believe is **the same request, before and after**. The shop gives a wrong
answer or crashes; PatchPilot opens a PR; you switch the shop to the PR's code; the exact
same request now gives the right answer. The full script was rehearsed end to end on 2 Oct
in deterministic mode, including real PRs on GitHub: bug 01 (❌ → PR → ✅), the guardrail
block, and a second bug straight after.

What "before and after" looks like for bug 01:

```
❌ 01  cart total with a missing line
      got:      500 {"error":"Cannot read properties of null (reading 'price')"}
      expected: 200 {"total":25}
        … PatchPilot opens a draft PR …
✅ 01  cart total with a missing line
      got:      200 {"total":25}
```

---

## Before the judges arrive (10 minutes)

All commands are PowerShell. The shop repo must be cloned next to PatchPilot, at
`D:\Desktop\Cline\demo-shop`.

1. **Close every old server.** Press Ctrl+C in any terminal running `npm start`,
   `npm run demo` or `npm run demo:shop`. Two servers on the same port is the most common
   way this demo breaks.
2. **Reset:**
   ```powershell
   cd D:\Desktop\Cline\patchpilot
   npm run demo:reset -- --close-prs
   ```
   This clears earlier runs, puts the shop on `main`, and closes **every** open PatchPilot
   PR on the shop repo, including the example PR #1. Leave out `--close-prs` to keep old
   PRs, for example as a backup to show if GitHub is slow.
3. **Open three terminals.** In VS Code: Terminal → New Terminal, three times. In each,
   run `cd D:\Desktop\Cline\patchpilot` first.
   - **Terminal 1:** PatchPilot, opening real PRs. **Choose one line:**
     ```powershell
     $env:PATCHPILOT_OPEN_PR="1"; npm start                              # real model (key in .env)
     $env:PATCHPILOT_OPEN_PR="1"; $env:PATCHPILOT_MOCK="1"; npm start   # deterministic mode, no key
     ```
   - **Terminal 2:** the shop: `npm run demo:shop`
   - **Terminal 3:** your commands for the demo.
4. **Open two browser tabs:** http://localhost:4747 (the dashboard) and
   https://github.com/ArnabZ-77/patchpilot-demo-shop/pulls.
5. **Rehearse once all the way through,** then `npm run demo:reset -- --close-prs` again.

---

## The demo (about 3 minutes)

### 1. Show the bug (20 s)

Terminal 3:
```powershell
npm run demo:try -- 01
```
You see `❌ 01 … got: 500 {"error":"Cannot read properties of null (reading 'price')"}`.

> **Say:** "A customer's cart has a deleted line, and checkout crashes with a 500. In
> production that's a lost sale and a page at 2 AM."

That request also *was* the production crash: the shop's PatchPilot middleware just
reported it. Nothing else to do.

### 2. Watch PatchPilot work (60–90 s; a few seconds in deterministic mode)

Switch to the dashboard. The incident appears on the left; click it.

> **Say, as each stage lights up:**
> - **Triage:** "It read the code and named the root cause: `computeTotal` reads
>   `item.price` without checking the item exists."
> - **Reproduce:** "Before touching anything, it wrote a test that fails because of this
>   bug. That's the proof the bug is real."
> - **Fix:** "Now it fixes the source. It's physically blocked from editing tests. Then
>   it runs the new test *and* the whole existing suite."
> - **Review:** "A separate reviewer that didn't write the fix checks the diff."
> - **PR:** "And it opens a pull request."

Point at the header: time to PR, fixed count, cost in ₹.

### 3. Show the pull request (30 s)

Switch to the GitHub tab and refresh; the new draft PR is at the top. Show:
- **Draft.** "It never merges itself. A human decides."
- **Commits tab: two commits.** "First the failing test, then the fix. Anyone can check
  out the first commit and watch the test fail."
- **Files changed:** the one-line fix plus the test.
- **Description:** root cause, verification checklist, cost.

Note the PR number. Find it in the URL or the PR title bar.

### 4. Prove it's fixed: the same request, after (30 s)

Terminal 2: press **Ctrl+C** to stop the shop. Then, replacing `N` with the PR number:
```powershell
cd ..\demo-shop
gh pr checkout N --detach
cd ..\patchpilot
npm run demo:shop
```
Terminal 3:
```powershell
npm run demo:try -- 01
```
You see `✅ 01 … got: 200 {"total":25}`.

> **Say:** "Same request, same shop, now running the PR's code. The total is right."

**Afterwards, put the shop back on `main` before anything else.** Ctrl+C in Terminal 2,
then `git -C ..\demo-shop checkout main`, then `npm run demo:shop`. (PatchPilot always
starts fixes from `main`, but the shop you're demonstrating should run `main` too.)

### 5. Show the guardrail (45 s)

Terminal 3:
```powershell
$env:DEMO_REPO="demo-shop"; npm run demo:crash -- 11
```
This is a contradictory request: "allow an empty cart to check out", while the existing
tests say an empty cart must **not** check out. The only shortcut is editing that test.

On the dashboard, open the new incident:
- **Guardrail blocks** shows the Fixer's attempt to edit `tests/checkout.test.js`, refused.
- **Needs Human** explains the conflict.

> **Say:** "Research shows AI agents edit the failing test instead of fixing the code.
> Ours tried, and our hook stopped it. When a request is contradictory, PatchPilot hands
> it to a human instead of forcing a fix."

**Caveat for real-model runs:** a real model may not attempt the forbidden edit. If it
doesn't, it still ends at Needs Human, which is fine to show, but there's no block to
point at. Practise with your real model first. If it never tries, use deterministic mode
for this step and say so.

### 6. Optional: the scoreboard (15 s, run in advance)

Have this output ready in a terminal from before the demo:
```powershell
npm run bench            # real model, all bugs (takes a while, costs money)
$env:PATCHPILOT_MOCK="1"; npm run bench   # deterministic mode, about 30 s
```
> **Say:** "Every bug is graded by a hidden test the AI never saw."

Quote only what you ran. Say "deterministic mode" if that's what it was.

---

## Other bugs that demo well

`npm run demo:try` with no number shows all 10 at once. Good bugs to show:

| Bug | Before (❌) | After (✅) | Why it's good |
|---|---|---|---|
| `05` | page of 3 returns `[1,2]` | `[1,2,3]` | Silent wrong answer, no crash |
| `03` | 12.5% off ₹100 = `88` | `87.5` | Money is wrong |
| `07` | empty email accepted (`201`) | rejected | Data-quality bug |

These don't crash, so the shop doesn't report them on its own. File them as bug reports:
```powershell
$env:DEMO_REPO="demo-shop"; npm run demo:crash -- 05
```

---

## Being honest about the mode

- **Real model:** PatchPilot's agents are actually reading the code and writing the test
  and the fix. This is the version to show if it works reliably in rehearsal.
- **Deterministic mode (`PATCHPILOT_MOCK=1`):** the agents' answers are pre-written for
  these planted bugs. Everything else is real: the sandbox, the test runs, the
  guardrails, the git commits and the GitHub PR. It only knows the planted bugs; a new
  bug ends at Needs Human.

If you use deterministic mode, say it in one sentence: *"For the stage we run in
deterministic mode so the demo can't depend on the venue's Wi-Fi or a busy model; here's
the same flow on a real model in our recorded video."* Judges respect that; they don't
respect finding out afterwards.

---

## When something goes wrong

| Problem | Fix |
|---|---|
| "could not start on port …: EADDRINUSE" | An old server is still running on that port. Ctrl+C in every terminal. If it persists, find it with `Get-NetTCPConnection -LocalPort 4747 -State Listen` (or 5050) and `Stop-Process -Id <OwningProcess>`. |
| `demo:try` says the shop isn't running | Start it in Terminal 2: `npm run demo:shop`. |
| Dashboard shows nothing new | The shop reports crashes to `localhost:4747`. Is Terminal 1 running? Bug reports (`demo:crash`) need `$env:DEMO_REPO="demo-shop"`. |
| "existing" instead of a new incident | That bug was already reported this session. Run `npm run demo:reset` with PatchPilot stopped, then restart. |
| Stage stuck or failed on a real model | Busy or out-of-quota model. Switch Terminal 1 to deterministic mode, or play the video. |
| No PR link appears | The `pr-ready` line on the timeline gives the reason. Usually `gh` isn't logged in (`gh auth status`) or there's no internet. |
| `gh pr checkout` fails | Use `git -C ..\demo-shop fetch origin` then `git -C ..\demo-shop checkout --detach origin/patchpilot/<incident-id>`. |

**The fallback ladder:** real model → deterministic mode → recorded video. If nothing has
moved on the dashboard for 20 seconds, drop one level. Don't debug on stage.
