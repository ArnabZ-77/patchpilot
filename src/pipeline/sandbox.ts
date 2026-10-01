import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { SANDBOX_DIR } from "../config.ts";
import type { RepoConfig } from "../types.ts";

/**
 * One git worktree per incident (OpenHands/SWE-agent's "every task in an
 * isolated container" principle, done with worktrees since Docker isn't
 * assumed to be available). The agent's cwd is this worktree, never the
 * developer's working copy — a bad edit never touches the main checkout.
 */
export async function createSandbox(repo: RepoConfig, incidentId: string): Promise<{ dir: string; cwd: string; branch: string }> {
  const dir = path.join(SANDBOX_DIR, incidentId);
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const branch = `patchpilot/${incidentId}`;
  const baseRef = repo.baseRef ?? "HEAD";
  await git(repo.root, ["worktree", "add", "-f", "-B", branch, dir, baseRef]);
  const cwd = repo.subdir ? path.join(dir, repo.subdir) : dir;
  return { dir, cwd, branch };
}

export async function destroySandbox(repo: RepoConfig, dir: string): Promise<void> {
  try {
    await git(repo.root, ["worktree", "remove", "--force", dir]);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function diffStat(cwd: string): Promise<{ files: string[]; insertions: number; deletions: number; diff: string }> {
  const diff = await git(cwd, ["diff", "--no-color"]);
  const nameOnly = await git(cwd, ["diff", "--name-only"]);
  const numstat = await git(cwd, ["diff", "--numstat"]);
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [ins, del] = line.split("\t");
    insertions += Number(ins) || 0;
    deletions += Number(del) || 0;
  }
  return { files: nameOnly.split("\n").filter(Boolean), insertions, deletions, diff };
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["-c", "user.email=patchpilot@local", "-c", "user.name=PatchPilot", "commit", "-m", message]);
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function revertAll(cwd: string): Promise<void> {
  await git(cwd, ["checkout", "--", "."]);
  await git(cwd, ["clean", "-fd"]);
}

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`git ${args.join(" ")} failed: ${err || out}`))));
    child.on("error", reject);
  });
}
