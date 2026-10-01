/**
 * Shared types for PatchPilot.
 *
 * The incident payload follows the Sentry event shape (exception.values[],
 * stacktrace.frames[] oldest→newest) so any Sentry-compatible SDK can be
 * pointed at the webhook with minimal translation.
 */

export interface StackFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app?: boolean;
}

export interface ExceptionValue {
  type?: string;
  value?: string;
  module?: string;
  mechanism?: { type: string; handled?: boolean; data?: Record<string, unknown> };
  stacktrace?: { frames: StackFrame[] };
}

export interface Breadcrumb {
  timestamp: string;
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, unknown>;
}

/** Webhook payload posted by the capture middleware. */
export interface IncidentEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  environment?: string;
  release?: string;
  server_name?: string;
  /** Express route pattern, e.g. "GET /orders/:id" */
  transaction?: string;
  fingerprint?: string[];
  tags?: Record<string, string>;
  request?: { method?: string; url?: string; headers?: Record<string, string>; query_string?: string; data?: unknown };
  breadcrumbs?: Breadcrumb[];
  exception: { values: ExceptionValue[] };
  sdk?: { name?: string; version?: string };
}

export type Stage =
  | "received"
  | "triage"
  | "reproduce"
  | "fix"
  | "validate"
  | "review"
  | "pr"
  | "done"
  | "needs_human"
  | "failed";

export interface Suspect {
  file: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  score: number;
  evidence: Array<"stack_frame" | "llm" | "search">;
  reason?: string;
}

export interface TriageResult {
  root_cause: string;
  intended_behavior: string;
  suspects: Suspect[];
  confidence: number;
  needs_human?: string;
}

export interface ReproductionResult {
  test_file: string;
  test_name: string;
  failure_summary: string;
  /** sha256 of the test file once it is accepted. The Fixer may not change it. */
  lockHash: string;
}

export interface TestRun {
  command: string;
  passed: number;
  failed: number;
  durationMs: number;
  /** Filtered, bounded output suitable for feeding back to a model. */
  summary: string;
  failures: Array<{ name: string; message: string }>;
  exitCode: number | null;
  ok: boolean;
}

export interface FixAttempt {
  attempt: number;
  hypothesis: string;
  summary: string;
  filesChanged: string[];
  diff: string;
  reproTest?: TestRun;
  fullSuite?: TestRun;
  hardChecks: HardCheckResult[];
  outcome: "accepted" | "rejected" | "escalated";
  rejectionReason?: string;
}

export interface HardCheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ReviewResult {
  confidence: number;
  addresses_root_cause: boolean;
  behavior_change_outside_crash_path: boolean;
  risks: string[];
  open_question?: string;
}

export interface GuardrailBlock {
  ts: string;
  stage: Stage;
  tool: string;
  input: unknown;
  reason: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
  inr: number;
  byStage: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; usd: number }>;
}

export interface TimelineEntry {
  ts: string;
  stage: Stage;
  type: string;
  text?: string;
  data?: unknown;
}

export interface Incident {
  id: string;
  fingerprint: string;
  repo: string;
  title: string;
  exceptionType: string;
  exceptionValue: string;
  transaction?: string;
  environment?: string;
  release?: string;
  events: IncidentEvent[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  stage: Stage;
  stageHistory: Array<{ stage: Stage; ts: string }>;
  frames: Array<{ file: string; line?: number; column?: number; function?: string; inApp: boolean }>;
  sandbox?: { dir: string; cwd: string; branch: string; baseRef: string };
  triage?: TriageResult;
  reproduction?: ReproductionResult;
  baseline?: TestRun;
  attempts: FixAttempt[];
  review?: ReviewResult;
  pr?: { branch: string; title: string; body: string; url?: string; commit?: string; diff: string };
  needsHumanReason?: string;
  error?: string;
  guardrailBlocks: GuardrailBlock[];
  usage: UsageTotals;
  timeline: TimelineEntry[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface RepoConfig {
  /** Path to the git repository root, relative to patchpilot.config.json. */
  root: string;
  /** Subdirectory inside the repo that is the application (agent cwd). "" for repo root. */
  subdir?: string;
  /** Test command (argv form, run without a shell). */
  testCommand: string[];
  /** Directories/globs (relative to subdir) that hold tests. Reproducer may write only here; Fixer never. */
  testPaths: string[];
  /** Paths the agents may never modify (auth, secrets, migrations, config). */
  protectedPaths: string[];
  /** Max changed lines in a fix before it is rejected as too large. */
  maxDiffLines?: number;
  /** Max files a fix may touch. */
  maxDiffFiles?: number;
  /** Git ref to branch from for new incidents (default: HEAD). */
  baseRef?: string;
}

export interface PatchPilotConfig {
  repos: Record<string, RepoConfig>;
  defaultRepo: string;
  maxFixAttempts: number;
  minTriageConfidence: number;
}
