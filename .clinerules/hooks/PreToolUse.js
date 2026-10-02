#!/usr/bin/env node
/**
 * Dev-Cline guardrail: the same policy PatchPilot enforces on its own agents,
 * applied to the Cline agent the team builds PatchPilot with ("we dogfood our
 * own guardrails").
 *
 * Cline runs this before every tool call: the call arrives as JSON on stdin,
 * and printing {"cancel": true, "errorMessage": "..."} blocks it.
 *
 * Blocks:
 *   - any write to .env / .env.* (secrets)
 *   - any change to benchmark/golden/ (the hidden tests that grade PatchPilot)
 *   - deleting test files (rm/del/Remove-Item on tests, or emptying a test file)
 *   - destructive git/shell commands (force push, reset --hard, rm -rf)
 * Everything else is allowed, including adding and editing tests.
 */
import { readFileSync } from "node:fs";

const WRITE_TOOLS = /^(write_to_file|replace_in_file|apply_diff|apply_patch|editor|write_files?|insert_content|search_and_replace|delete_file)$/i;
const SHELL_TOOLS = /^(execute_command|run_commands|bash|shell)$/i;

const SECRET_PATH = /(^|[\\/])\.env($|\.)/i;
const GOLDEN_PATH = /(^|[\\/])benchmark[\\/]golden([\\/]|$)/i;
const TEST_PATH = /(^|[\\/])(tests?|__tests__)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$/i;

const DESTRUCTIVE_COMMAND = /git\s+push\b[^\n]*(--force|-f\b)|git\s+reset\s+--hard|rm\s+-rf?\s|Remove-Item\b[^\n]*-Recurse/i;
const DELETE_COMMAND = /\b(rm|del|erase|Remove-Item|git\s+rm)\b/i;

export function decide(payload) {
  const call = payload?.preToolUse ?? payload?.toolCall ?? payload ?? {};
  const toolName = String(call.toolName ?? call.tool?.name ?? call.name ?? "");
  const params = call.parameters ?? call.input ?? call.arguments ?? {};

  if (WRITE_TOOLS.test(toolName)) {
    for (const p of pathsIn(params)) {
      if (SECRET_PATH.test(p)) return block(`Dev guardrail: ${toolName} on "${p}" blocked — .env files hold secrets and are never edited by an agent.`);
      if (GOLDEN_PATH.test(p)) return block(`Dev guardrail: "${p}" is a hidden benchmark test; agents may not change what grades them.`);
      if (TEST_PATH.test(p) && (/delete/i.test(toolName) || isEmptyWrite(params))) {
        return block(`Dev guardrail: deleting or emptying test file "${p}" is blocked. Fix the code, not the test.`);
      }
    }
  }

  if (SHELL_TOOLS.test(toolName)) {
    for (const cmd of commandsIn(params)) {
      if (DESTRUCTIVE_COMMAND.test(cmd)) return block(`Dev guardrail: destructive command blocked: "${cmd.slice(0, 120)}"`);
      if (DELETE_COMMAND.test(cmd) && (TEST_PATH.test(cmd) || GOLDEN_PATH.test(cmd))) return block(`Dev guardrail: deleting tests is blocked: "${cmd.slice(0, 120)}"`);
      if (SECRET_PATH.test(cmd) && />|Set-Content|Out-File|Add-Content|tee\b/i.test(cmd)) return block(`Dev guardrail: writing to a .env file from the shell is blocked.`);
    }
  }

  return { cancel: false };
}

function pathsIn(params) {
  const out = [];
  for (const key of ["path", "file_path", "filePath", "target_file", "file"]) {
    if (typeof params[key] === "string") out.push(params[key]);
  }
  if (Array.isArray(params.files)) {
    for (const f of params.files) out.push(typeof f === "string" ? f : f?.path);
  }
  // apply_patch style: "*** Update File: path"
  const patch = params.input ?? params.patch ?? params.diff;
  if (typeof patch === "string") {
    for (const m of patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)) out.push(m[1].trim());
  }
  return out.filter((p) => typeof p === "string" && p.length > 0);
}

function commandsIn(params) {
  if (typeof params.command === "string") return [params.command];
  if (Array.isArray(params.commands)) return params.commands.filter((c) => typeof c === "string");
  return [];
}

function isEmptyWrite(params) {
  const content = params.content ?? params.new_text ?? params.text;
  return typeof content === "string" && content.trim() === "";
}

function block(errorMessage) {
  return { cancel: true, errorMessage };
}

// Run as a hook: read the payload from stdin, print the decision. Fail open on
// unparseable input so a hook bug can't freeze the developer's agent.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    /* fail open */
  }
  process.stdout.write(JSON.stringify(decide(payload)));
}
