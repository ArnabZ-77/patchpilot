import type { Incident, PatchPilotConfig, RepoConfig } from "../types.ts";
import type { IncidentStore } from "../store.ts";
import { resolveModelSettings } from "../config.ts";
import { createSandbox } from "./sandbox.ts";
import { addUsage, loadCatalogPricing } from "./cost.ts";
import { runTriage } from "../agents/triage.ts";
import { runReproduce } from "../agents/reproduce.ts";
import { runFixAttempt } from "../agents/fix.ts";
import { runReview } from "../agents/review.ts";
import { buildPrBody, buildPrTitle, openDraftPr } from "./pr.ts";
import { OPEN_PR } from "../config.ts";
import { commitAll } from "./sandbox.ts";

/**
 * Runs the full Triage → Reproduce → Fix(×N) → Review → PR pipeline for one
 * incident, end to end. Every stage transition and guardrail block is
 * logged through the store so the dashboard's SSE stream sees it live.
 */
export async function processIncident(inc: Incident, repo: RepoConfig, config: PatchPilotConfig, store: IncidentStore): Promise<void> {
  const settings = resolveModelSettings();
  await loadCatalogPricing(settings.providerId, settings.modelId);
  inc.startedAt = new Date().toISOString();
  store.persist(inc);

  try {
    store.setStage(inc, "triage", "Triage agent investigating root cause");
    const sandbox = await createSandbox(repo, inc.id);
    inc.sandbox = { dir: sandbox.dir, cwd: sandbox.cwd, branch: sandbox.branch, baseRef: repo.baseRef ?? "HEAD" };
    store.persist(inc);

    const triage = await runTriage(inc, repo, settings, sandbox.cwd, (type, text) => emit(store, inc, type, text));
    const tUsage = (triage as any).__usage;
    if (tUsage) addUsage(inc, "triage", settings.modelId, tUsage);
    inc.triage = triage;
    store.log(inc, "triage-result", triage.root_cause, triage);

    if (triage.confidence < config.minTriageConfidence) {
      return escalate(inc, store, triage.needs_human || `Triage confidence ${triage.confidence.toFixed(2)} is below the ${config.minTriageConfidence} threshold — insufficient evidence to proceed automatically.`);
    }

    store.setStage(inc, "reproduce", "Reproducer agent writing a failing test");
    const { result: repro, baseline, usage: rUsage } = await runReproduce(inc, triage, repo, settings, sandbox.cwd, (type, text) => emit(store, inc, type, text));
    addUsage(inc, "reproduce", settings.modelId, rUsage);
    inc.reproduction = repro;
    inc.baseline = baseline;
    store.log(inc, "reproduction-result", `${repro.test_file} fails: ${repro.failure_summary}`, repro);

    // Commit the accepted test on its own. Fixer diffs then contain only Fixer
    // changes, a failed attempt reverts to "test present, bug unfixed", and the
    // PR history reads test commit → fix commit.
    await commitAll(sandbox.dir, `test: reproduce ${inc.id} (fails before fix)`);

    let lastFeedback: string | undefined;
    let accepted: Awaited<ReturnType<typeof runFixAttempt>> | undefined;

    for (let attemptNo = 1; attemptNo <= config.maxFixAttempts; attemptNo++) {
      store.setStage(inc, "fix", `Fixer attempt ${attemptNo}/${config.maxFixAttempts}`);
      const attempt = await runFixAttempt(inc, triage, repro, repo, settings, sandbox.cwd, attemptNo, lastFeedback, (type, text) => emit(store, inc, type, text));
      addUsage(inc, "fix", settings.modelId, attempt.usage);
      inc.attempts.push(attempt);
      store.log(inc, "fix-attempt", `attempt ${attemptNo}: ${attempt.outcome}`, attempt);

      if (attempt.outcome === "accepted") {
        accepted = attempt;
        break;
      }
      if (attempt.outcome === "escalated") {
        return escalate(inc, store, attempt.rejectionReason ?? "Fixer determined the reproduction test contradicts the intended behavior.");
      }
      lastFeedback = attempt.rejectionReason;
    }

    if (!accepted) {
      return escalate(inc, store, `Exhausted ${config.maxFixAttempts} fix attempts without a passing, guardrail-clean patch. Last reason: ${lastFeedback ?? "unknown"}`);
    }

    store.setStage(inc, "review", "Critic reviewing the diff independently");
    const review = await runReview(inc, triage, accepted, settings);
    addUsage(inc, "review", settings.modelId, review.usage);
    inc.review = review;
    store.log(inc, "review-result", `confidence ${review.confidence}`, review);

    store.setStage(inc, "pr", "Preparing pull request");
    const commit = await commitAll(sandbox.dir, `fix: ${triage.root_cause}`.slice(0, 72));
    const title = buildPrTitle(inc, triage);
    const body = buildPrBody(inc, triage, accepted, review);
    let url: string | undefined;
    let prError: string | undefined;
    if (OPEN_PR) ({ url, error: prError } = await openDraftPr(sandbox.dir, sandbox.branch, title, body));
    inc.pr = { branch: sandbox.branch, title, body, url, commit, diff: accepted.diff };
    const prNote = url
      ? `Draft PR opened: ${url}`
      : OPEN_PR
        ? `Patch committed on branch ${sandbox.branch}, but opening the PR failed: ${prError}`
        : `Patch committed on branch ${sandbox.branch} (PR creation off; set PATCHPILOT_OPEN_PR=1)`;
    store.log(inc, "pr-ready", prNote, inc.pr);

    finish(inc, store, "done");
  } catch (err) {
    inc.error = err instanceof Error ? err.message : String(err);
    store.log(inc, "error", inc.error);
    finish(inc, store, "failed");
  }
}

function escalate(inc: Incident, store: IncidentStore, reason: string): void {
  inc.needsHumanReason = reason;
  store.log(inc, "needs-human", reason);
  finish(inc, store, "needs_human");
}

function finish(inc: Incident, store: IncidentStore, stage: Incident["stage"]): void {
  inc.finishedAt = new Date().toISOString();
  inc.durationMs = inc.startedAt ? Date.parse(inc.finishedAt) - Date.parse(inc.startedAt) : undefined;
  store.setStage(inc, stage);
  store.persist(inc);
}

function emit(store: IncidentStore, inc: Incident, type: string, text?: string): void {
  if (type === "guardrail-block") {
    inc.guardrailBlocks.push({ ts: new Date().toISOString(), stage: inc.stage, tool: "?", input: undefined, reason: text ?? "blocked" });
  }
  store.log(inc, type, text);
}
