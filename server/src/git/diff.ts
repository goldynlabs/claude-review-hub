import { git } from "./worktree.js";

/**
 * Where a branch actually lives depends on how the checkout was made. A normal
 * clone has it as `origin/<branch>`; a bare clone, which is what the skill tells
 * the agent to make when no local checkout exists, has no remote-tracking refs
 * at all and keeps the fetched branch at `refs/heads/<branch>`.
 */
async function resolveRef(repoPath: string, branch: string): Promise<string> {
  const candidates = [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`, branch];
  for (const candidate of candidates) {
    try {
      await git(repoPath, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // Not in this repo; try the next spelling.
    }
  }
  throw new Error(
    `Branch '${branch}' is not in ${repoPath}. Fetch it there, or re-run the review so the agent refreshes the checkout.`,
  );
}

/**
 * Rendering only. The agent produces its own diff while reviewing; this is what
 * the Diff panel asks for when the user clicks a file, so it stays read-only
 * and costs nothing.
 */
export async function fileDiff(input: {
  repoPath: string;
  baseBranch: string;
  sourceBranch: string;
  file?: string;
}): Promise<string> {
  const [base, source] = await Promise.all([
    resolveRef(input.repoPath, input.baseBranch),
    resolveRef(input.repoPath, input.sourceBranch),
  ]);
  const args = ["diff", "--no-color", "--find-renames", `${base}...${source}`];
  if (input.file) args.push("--", input.file);
  return git(input.repoPath, args);
}
