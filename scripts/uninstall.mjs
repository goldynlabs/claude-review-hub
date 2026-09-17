import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXCLUDED_PATHS, SKILL_NAMES, excludeFile } from "./install-skill.mjs";

/**
 * Removes the tool from a repo. The skill and the ignore entries always go;
 * the session history, findings and worktrees only go when explicitly asked,
 * because they are the work the tool produced, not the tool itself.
 */
export function uninstallTool(target, { purge = false } = {}) {
  const log = (message) => console.log(message);
  const removed = [];

  for (const name of SKILL_NAMES) {
    const skill = path.join(target, ".claude", "skills", name);
    if (!fs.existsSync(skill)) continue;
    fs.rmSync(skill, { recursive: true, force: true });
    if (!removed.includes("skill")) removed.push("skill");
    log(`  skill     removed -> .claude/skills/${name}`);
    // Leave .claude/skills and .claude behind only if something else lives there.
    for (const dir of [path.dirname(skill), path.join(target, ".claude")]) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
  }

  for (const file of [excludeFile(target), path.join(target, ".gitignore")]) {
    // .gitignore is checked too, because older versions of the tool wrote there.
    if (!file || !fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const kept = lines.filter((line) => !EXCLUDED_PATHS.includes(line.trim()));
    if (kept.length !== lines.length) {
      fs.writeFileSync(file, kept.join("\n"));
      removed.push("ignore");
      const where = path.basename(file) === "exclude" ? ".git/info/exclude" : ".gitignore";
      log(`  ignore    entries removed from ${where}`);
    }
  }

  const toolDir = path.join(target, ".review-tool");
  if (!fs.existsSync(toolDir)) {
    if (!removed.length) log("  nothing to remove; the tool was not installed here");
    return removed;
  }

  if (!purge) {
    log(`\n  Kept .review-tool/ (sessions, findings and worktrees).`);
    log(`  Remove it too with: npx claude-review-hub uninstall --purge`);
    return removed;
  }

  // Worktrees are registered inside the repo's own .git, so they must be
  // unregistered before the folder goes, or git is left with dangling entries.
  const worktreesDir = path.join(toolDir, "temp", "worktrees");
  if (fs.existsSync(worktreesDir)) {
    for (const name of fs.readdirSync(worktreesDir)) {
      const marker = path.join(worktreesDir, name, ".review-worktree.json");
      if (!fs.existsSync(marker)) continue;
      try {
        // A BOM would break JSON.parse and lose the whole registration.
        const info = JSON.parse(fs.readFileSync(marker, "utf8").replace(/^﻿/, ""));
        execFileSync("git", ["-C", info.repoPath, "worktree", "remove", info.path, "--force"], {
          stdio: "ignore",
        });
        log(`  worktree  removed -> ${name}`);
      } catch (error) {
        const reason = String(error?.message ?? error).split(/\r?\n/)[0];
        log(`  worktree  ${name}: ${reason}`);
      }
    }
  }

  fs.rmSync(toolDir, { recursive: true, force: true });
  removed.push("data");
  log("  data      removed -> .review-tool/");

  // Pruning only works once the directories are gone, so it runs last.
  try {
    execFileSync("git", ["-C", target, "worktree", "prune"], { stdio: "ignore" });
  } catch {
    // Not fatal: git drops the stale entry on its own next prune.
  }
  return removed;
}
