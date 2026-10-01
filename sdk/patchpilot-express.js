// @ts-check
/**
 * PatchPilot error-capture middleware for Express (zero dependencies).
 *
 * Usage:
 *   import { patchpilot } from "patchpilot/sdk/patchpilot-express.js";
 *   app.use(patchpilot({ endpoint: "http://localhost:4747/api/incidents", repo: "demo-app", root: process.cwd() }));
 *
 * Builds a Sentry-compatible event (exception.values[], stacktrace.frames[]
 * oldest→newest, in_app flags, transaction, breadcrumbs) and POSTs it to the
 * PatchPilot webhook. Never throws; never blocks the response; strips auth
 * headers and never forwards request bodies unless `includeBody` is set.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SDK = { name: "patchpilot.express", version: "0.1.0" };
const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

/**
 * @param {{ endpoint: string, repo?: string, root?: string, environment?: string, release?: string, includeBody?: boolean, timeoutMs?: number, onSent?: (ev: any) => void }} opts
 */
export function patchpilot(opts) {
  const root = path.resolve(opts.root || process.cwd());
  return function patchpilotErrorHandler(err, req, res, next) {
    try {
      const ev = buildEvent(err, req, { ...opts, root });
      void send(opts.endpoint, ev, opts.timeoutMs ?? 3000).then(() => opts.onSent?.(ev));
    } catch {
      /* capture must never break the app */
    }
    next(err);
  };
}

/** @param {unknown} err @param {any} req @param {{ repo?: string, root: string, environment?: string, release?: string, includeBody?: boolean }} opts */
export function buildEvent(err, req, opts) {
  const error = err instanceof Error ? err : new Error(String(err));
  const values = [];
  // Cause chain: oldest (root cause) first, as Sentry requires.
  const chain = [];
  for (let e = /** @type {any} */ (error), i = 0; e && i < 5; e = e.cause, i++) chain.unshift(e);
  for (const e of chain) {
    values.push({
      type: e.name || "Error",
      value: String(e.message ?? e),
      mechanism: { type: "express", handled: false },
      stacktrace: { frames: parseStack(e.stack || "", opts.root) },
    });
  }
  const route = req?.route?.path ? `${req.method} ${req.baseUrl || ""}${req.route.path}` : req ? `${req.method} ${req.path}` : undefined;
  const headers = {};
  for (const [k, v] of Object.entries(req?.headers || {})) if (!SENSITIVE.test(k)) headers[k] = Array.isArray(v) ? v.join(",") : String(v);
  return {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    environment: opts.environment || process.env.NODE_ENV || "production",
    release: opts.release,
    server_name: process.env.HOSTNAME,
    transaction: route,
    tags: { repo: opts.repo || path.basename(opts.root), runtime: `node ${process.versions.node}` },
    request: req
      ? {
          method: req.method,
          url: req.originalUrl || req.url,
          headers,
          query_string: req.originalUrl?.includes("?") ? req.originalUrl.split("?")[1] : undefined,
          data: opts.includeBody ? req.body : undefined,
        }
      : undefined,
    breadcrumbs: Array.isArray(req?.patchpilotBreadcrumbs) ? req.patchpilotBreadcrumbs.slice(-20) : [],
    exception: { values },
    sdk: SDK,
  };
}

/**
 * Parse a V8 stack into Sentry frames (oldest first = last frame raised).
 * @param {string} stack @param {string} root
 */
export function parseStack(stack, root) {
  const frames = [];
  const re = /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?\s*$/;
  for (const line of stack.split("\n").slice(1)) {
    const m = re.exec(line);
    if (!m) continue;
    const [, fn, file, ln, col] = m;
    const abs = file.replace(/^file:\/\/\/?/, "").replace(/^async\s+/, "");
    const inApp = !/node_modules[\\/]/.test(abs) && !abs.startsWith("node:") && !/^internal[\\/]/.test(abs);
    const frame = { function: fn?.replace(/^async\s+/, "") || "<anonymous>", abs_path: abs, filename: relative(abs, root), lineno: Number(ln), colno: Number(col), in_app: inApp };
    if (inApp) attachContext(frame);
    frames.push(frame);
  }
  return frames.reverse();
}

function relative(abs, root) {
  const a = abs.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  return a.toLowerCase().startsWith(r.toLowerCase() + "/") ? a.slice(r.length + 1) : a;
}

function attachContext(frame) {
  try {
    const st = fs.statSync(frame.abs_path);
    if (st.size > 512 * 1024) return;
    const lines = fs.readFileSync(frame.abs_path, "utf8").split(/\r?\n/);
    const i = frame.lineno - 1;
    frame.context_line = lines[i];
    frame.pre_context = lines.slice(Math.max(0, i - 5), i);
    frame.post_context = lines.slice(i + 1, i + 6);
  } catch {
    /* source unavailable */
  }
}

async function send(endpoint, ev, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev), signal: ctrl.signal });
  } catch {
    /* PatchPilot offline: drop silently */
  } finally {
    clearTimeout(t);
  }
}
