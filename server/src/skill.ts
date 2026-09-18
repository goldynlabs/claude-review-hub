import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./paths.js";
import { skillSource } from "./pkg.js";
import { allProviders, installedProviders } from "./providers/index.js";

export type SkillState = "installed" | "updated" | "current" | "missing-source";

export interface SkillStatus {
  skill: string;
  state: SkillState;
}

function treeSnapshot(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const files: Array<[string, string]> = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push([path.relative(root, full).replace(/\\/g, "/"), fs.readFileSync(full).toString("base64")]);
    }
  };
  visit(root);
  return JSON.stringify(files);
}

function syncTree(source: string, target: string): void {
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
 * The agent does the whole job by following a skill, so the skill has to be
 * there however the server was started: through `npx claude-review-hub`, or straight
 * from a dev shell. Copying it on boot also keeps it in step with the tool.
 */
function installSkill(name: string): SkillState {
  const from = path.join(skillSource, name);
  const sourceFile = path.join(from, "SKILL.md");
  if (!fs.existsSync(sourceFile)) return "missing-source";

  const target = path.join(projectRoot, ".claude", "skills", name);
  const existed = fs.existsSync(target);
  if (treeSnapshot(from) === treeSnapshot(target)) return "current";

  syncTree(from, target);
  return existed ? "updated" : "installed";
}

/**
 * One skill per host, all of them, because the launcher scripts install them
 * before this process exists and two rules about the same folder would drift.
 * Which hosts the agent is actually told to use is a separate question, and
 * that one does follow the CLIs on this machine: see `availableProviders`.
 */
export async function ensureSkills(): Promise<SkillStatus[]> {
  // Also primes the installed-CLI cache the prompt builders read.
  await installedProviders();
  return allProviders().map((provider) => ({ skill: provider.skill, state: installSkill(provider.skill) }));
}
