import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function treeSnapshot(root) {
  if (!fs.existsSync(root)) return null;
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push([path.relative(root, full).replace(/\\/g, "/"), fs.readFileSync(full).toString("base64")]);
    }
  };
  visit(root);
  return JSON.stringify(files);
}

/** Replace the complete tool-owned tree, staging first so a failed copy leaves the old skill intact. */
function syncTree(source, target) {
  const staging = `${target}.new-${process.pid}`;
  const backup = `${target}.old-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, staging, { recursive: true });
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  try {
    fs.renameSync(staging, target);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
}

/**
 * Puts the forked per-host skills in the target repo and keeps the tool's own
 * state out of that repo's history. Idempotent: safe to run on every start.
 */
export function installSkill(target, { quiet = false } = {}) {
  const log = (message) => !quiet && console.log(message);
  const done = { skill: false, excluded: false };

  for (const name of SKILL_NAMES) {
    const skillTarget = path.join(target, ".claude", "skills", name);
    const source = path.join(skillRoot, name);
    const existed = fs.existsSync(skillTarget);

    if (treeSnapshot(source) !== treeSnapshot(skillTarget)) {
      syncTree(source, skillTarget);
      log(`  skill     ${existed ? "updated" : "installed"} -> .claude/skills/${name}`);
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
  try {
    const resolved = execFileSync("git", ["-C", target, "rev-parse", "--git-path", "info/exclude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.isAbsolute(resolved) ? resolved : path.resolve(target, resolved);
  } catch {
    return null;
  }
}
