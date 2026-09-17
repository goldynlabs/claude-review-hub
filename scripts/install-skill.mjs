import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(here, "..", "skill");

/** One skill per host the tool supports, discovered rather than listed twice. */
export const SKILL_NAMES = fs
  .readdirSync(skillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name);

/** What the tool adds to a repo, and what it must therefore keep out of git. */
export const EXCLUDED_PATHS = [".review-tool/", ...SKILL_NAMES.map((name) => `.claude/skills/${name}/`)];

/**
 * Puts the forked per-host skills in the target repo and keeps the tool's own
 * state out of that repo's history. Idempotent: safe to run on every start.
 */
export function installSkill(target, { quiet = false } = {}) {
  const log = (message) => !quiet && console.log(message);
  const done = { skill: false, excluded: false };

  for (const name of SKILL_NAMES) {
    const skillTarget = path.join(target, ".claude", "skills", name);
    const sourceFile = path.join(skillRoot, name, "SKILL.md");
    const targetFile = path.join(skillTarget, "SKILL.md");
    const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8") : null;
    const latest = fs.readFileSync(sourceFile, "utf8");

    if (current !== latest) {
      fs.mkdirSync(path.dirname(skillTarget), { recursive: true });
      fs.cpSync(path.join(skillRoot, name), skillTarget, { recursive: true });
      log(`  skill     ${current === null ? "installed" : "updated"} -> .claude/skills/${name}`);
      done.skill = true;
    }
  }

  // .git/info/exclude, not .gitignore: that file is tracked, and a work repo
  // must not show a modified file just because the tool was started in it.
  const exclude = excludeFile(target);
  if (exclude) {
    const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
    const missing = EXCLUDED_PATHS.filter((line) => !present.has(line));
    if (missing.length) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      const prefix = !existing || existing.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(exclude, `${prefix}${missing.join("\n")}\n`);
      log("  ignored   locally, in .git/info/exclude (your .gitignore is untouched)");
      done.excluded = true;
    }
  }

  return done;
}

export function isGitRepo(target) {
  return fs.existsSync(path.join(target, ".git"));
}

/**
 * Anywhere the dashboard can be opened. Not "is a git repo": the folder may be
 * a workspace holding several, and the agent resolves a repository itself and
 * reports the path it used. Only a path that is not there is worth refusing.
 */
export function isUsableTarget(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves .git/info/exclude, following the gitdir pointer when the repo is
 * itself a worktree (there .git is a file, not a directory).
 */
export function excludeFile(target) {
  const dotGit = path.join(target, ".git");
  if (!fs.existsSync(dotGit)) return null;
  if (fs.statSync(dotGit).isDirectory()) return path.join(dotGit, "info", "exclude");
  const pointer = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
  if (!pointer) return null;
  return path.join(path.resolve(target, pointer[1].trim()), "info", "exclude");
}
