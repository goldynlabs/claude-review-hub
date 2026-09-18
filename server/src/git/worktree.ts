import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getSettings } from "../config.js";

const exec = promisify(execFile);

export async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoPath, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export interface WorktreeInfo {
  path: string;
  repoPath: string;
  repo: string;
  branch: string;
  /** Last write to the worktree, which is when the review last touched it. */
  usedAt: string;
}

const REVIEW_WORKTREE = "/.review-tool/temp/worktrees/";

/**
 * The agent creates worktrees itself, so they are discovered by asking git
 * rather than by reading a marker the dashboard wrote. Only the ones under the
 * tool's own temp folder count as ours.
 */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const repos = getSettings().repos;
  const found: WorktreeInfo[] = [];

  for (const [repo, repoPath] of Object.entries(repos)) {
    if (!fs.existsSync(repoPath)) continue;
    let output = "";
    try {
      output = await git(repoPath, ["worktree", "list", "--porcelain"]);
    } catch {
      continue;
    }

    let current: { path?: string; branch?: string } = {};
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) current = { path: line.slice("worktree ".length) };
      else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      else if (line === "" && current.path) {
        const normalised = current.path.replace(/\\/g, "/").toLowerCase();
        if (normalised.includes(REVIEW_WORKTREE) && fs.existsSync(current.path)) {
          found.push({
            path: current.path,
            repoPath,
            repo,
            branch: current.branch ?? "detached",
            usedAt: fs.statSync(current.path).mtime.toISOString(),
          });
        }
        current = {};
      }
    }
  }
  return found;
}

export async function removeWorktree(repoPath: string, target: string): Promise<void> {
  const root = path.resolve(repoPath, ".review-tool", "temp", "worktrees");
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove a path outside the review worktree folder: ${target}`);
  }
  try {
    await git(repoPath, ["worktree", "remove", resolved, "--force"]);
  } catch {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  await git(repoPath, ["worktree", "prune"]).catch(() => undefined);
}

/** Worktrees are kept so the code stays browsable, then aged out. */
export async function pruneWorktrees(): Promise<string[]> {
  const ttlHours = getSettings().worktreeTtlHours;
  if (ttlHours <= 0) return [];
  const cutoff = Date.now() - ttlHours * 3_600_000;
  const removed: string[] = [];

  for (const worktree of await listWorktrees()) {
    if (new Date(worktree.usedAt).getTime() < cutoff) {
      await removeWorktree(worktree.repoPath, worktree.path);
      removed.push(worktree.path);
    }
  }
  return removed;
}
