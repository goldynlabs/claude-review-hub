import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tool is installed *into* a project: it is always launched from the repo
 * root it reviews, so Claude inherits that repo's CLAUDE.md, rules and memory.
 */
export const projectRoot = process.env.REVIEW_TOOL_PROJECT ?? process.cwd();

/** The tool's own version, from its package.json rather than from a constant. */
export const toolVersion: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // src/ in development, dist/ once built: the package root is above either.
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "";
  } catch {
    return "";
  }
})();

export const toolDir = path.join(projectRoot, ".review-tool");
export const configDir = path.join(toolDir, "config");
export const dataDir = path.join(toolDir, "data");
export const sessionsDir = path.join(dataDir, "sessions");
export const tempDir = path.join(toolDir, "temp");
export const worktreesDir = path.join(tempDir, "worktrees");
export const diffsDir = path.join(tempDir, "diffs");

export function ensureLayout(): void {
  for (const dir of [toolDir, configDir, dataDir, sessionsDir, tempDir, worktreesDir, diffsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // The tool's own state never belongs in the target repo's history.
  const ignore = path.join(toolDir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n", "utf8");
}

export function sessionDir(sessionId: string): string {
  const dir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function worktreePath(repo: string, prId: number): string {
  return path.join(worktreesDir, `${slug(repo)}-pr${prId}`);
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
