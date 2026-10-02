/**
 * Reset between demo rehearsals. Stop PatchPilot (Ctrl+C) before running.
 *
 *   npm run demo:reset                 # local cleanup only
 *   npm run demo:reset -- --close-prs  # also close open PatchPilot draft PRs on the demo-shop repo
 *
 * Local cleanup: deletes .patchpilot/ (incidents + sandboxes), prunes git
 * worktrees and local patchpilot/* branches in this repo and ../demo-shop, and
 * puts ../demo-shop back on main.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT, DATA_DIR } from "../src/config.ts";

const SHOP = path.resolve(PROJECT_ROOT, "..", "demo-shop");

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function cleanRepo(dir: string, label: string): void {
  if (!fs.existsSync(path.join(dir, ".git"))) return;
  for (const line of git(dir, ["worktree", "list", "--porcelain"]).split("\n")) {
    const wt = line.startsWith("worktree ") ? line.slice(9) : "";
    if (wt && path.resolve(wt) !== path.resolve(dir) && wt.replace(/\\/g, "/").includes("/.patchpilot/sandboxes/")) {
      git(dir, ["worktree", "remove", "--force", wt]);
    }
  }
  git(dir, ["worktree", "prune"]);
  const branches = git(dir, ["branch", "--list", "patchpilot/*", "--format=%(refname:short)"]).split("\n").filter(Boolean);
  for (const b of branches) git(dir, ["branch", "-D", b]);
  console.log(`${label}: removed ${branches.length} local patchpilot/* branch(es)`);
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log("patchpilot: cleared .patchpilot/ (incidents and sandboxes)");
cleanRepo(PROJECT_ROOT, "patchpilot");

if (fs.existsSync(SHOP)) {
  git(SHOP, ["checkout", "-q", "main"]);
  cleanRepo(SHOP, "demo-shop");
  console.log(`demo-shop: on ${git(SHOP, ["branch", "--show-current"])}`);

  if (process.argv.includes("--close-prs")) {
    const list = spawnSync("gh", ["pr", "list", "--state", "open", "--json", "number,headRefName"], { cwd: SHOP, encoding: "utf8" });
    const prs = JSON.parse(list.stdout || "[]") as Array<{ number: number; headRefName: string }>;
    for (const pr of prs.filter((p) => p.headRefName.startsWith("patchpilot/"))) {
      spawnSync("gh", ["pr", "close", String(pr.number), "--delete-branch"], { cwd: SHOP, encoding: "utf8" });
      console.log(`demo-shop: closed PR #${pr.number}`);
    }
  }
}
console.log("\nReady. Start PatchPilot and the shop again.");
