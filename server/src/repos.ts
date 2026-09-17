import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./config.js";
import { parseRemote } from "./providers/index.js";
import { projectRoot } from "./paths.js";

let cache: { at: number; repos: Record<string, string> } | null = null;
const TTL_MS = 30_000;

function remoteRepoName(repoPath: string): string | null {
  const config = path.join(repoPath, ".git", "config");
  if (!fs.existsSync(config)) return null;
  try {
    const url = /url\s*=\s*(.+)/.exec(fs.readFileSync(config, "utf8"))?.[1]?.trim();
    return url ? (parseRemote(url)?.repo ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Where each repository lives, worked out rather than configured: the project
 * the tool runs in, then its siblings, since checkouts are kept side by side.
 * Anything recorded from an earlier review wins, because it is known to be right.
 */
export function discoverRepos(): Record<string, string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.repos;

  const repos: Record<string, string> = {};
  const roots = [projectRoot, ...siblingsOf(projectRoot)];

  for (const repoPath of roots) {
    const name = remoteRepoName(repoPath);
    if (name && !repos[name]) repos[name] = repoPath;
  }

  // Paths recorded by a previous review override anything discovered.
  const merged = { ...repos, ...getSettings().repos };
  cache = { at: Date.now(), repos: merged };
  return merged;
}

function siblingsOf(target: string): string[] {
  const parent = path.dirname(target);
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

export function invalidateRepoCache(): void {
  cache = null;
}
