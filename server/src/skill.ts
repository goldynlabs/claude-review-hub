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
  const targetFile = path.join(target, "SKILL.md");
  const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8") : null;
  const latest = fs.readFileSync(sourceFile, "utf8");
  if (current === latest) return "current";

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(from, target, { recursive: true });
  return current === null ? "installed" : "updated";
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
