import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

/** The same three files, and the same document, that Settings > Backup writes. */
const BACKUP_KIND = "claude-review-hub-settings";
const SECTION_FILES = {
  settings: "settings.json",
  profiles: "profiles.json",
  prompts: "prompts.json",
};
const SECTIONS = Object.keys(SECTION_FILES);

/** One copy for the machine, outside any repo. Settings > Backup writes it. */
export const globalFile = path.join(os.homedir(), ".claude-review-hub", "settings.json");

function configDir(target) {
  return path.join(target, ".review-tool", "config");
}

/** The stored global configuration, or null when this machine has never saved one. */
export function readGlobal() {
  try {
    const parsed = JSON.parse(fs.readFileSync(globalFile, "utf8"));
    if (parsed?.kind !== BACKUP_KIND) return null;
    const sections = SECTIONS.filter((section) => parsed[section] !== undefined);
    return sections.length ? { file: parsed, sections } : null;
  } catch {
    return null;
  }
}

/**
 * Asked once per project and never again, so the answer is remembered even
 * when it was no: a project that declined should not be asked on every start.
 * Delete .review-tool/config/global.json to be asked again.
 */
function answered(target, imported) {
  const dir = configDir(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "global.json"),
    JSON.stringify({ askedAt: new Date().toISOString(), imported }, null, 2),
    "utf8",
  );
}

/** Never configured and never asked: anything here means this is not a first start. */
function firstRun(target) {
  const dir = configDir(target);
  if (fs.existsSync(path.join(dir, "global.json"))) return false;
  return !SECTIONS.some((section) => fs.existsSync(path.join(dir, SECTION_FILES[section])));
}

/**
 * Replacement, as an import in the dashboard is: each section the global copy
 * carries becomes exactly what it says. Sections it does not carry are left
 * for the project itself to answer, which is what the profiles question does
 * right after this one.
 */
export function importGlobal(target, stored = readGlobal()) {
  if (!stored) return [];
  const dir = configDir(target);
  fs.mkdirSync(dir, { recursive: true });
  for (const section of stored.sections) {
    fs.writeFileSync(
      path.join(dir, SECTION_FILES[section]),
      JSON.stringify(stored.file[section], null, 2),
      "utf8",
    );
  }
  console.log(`  global    ${stored.sections.join(", ")} imported -> .review-tool/config/`);
  return stored.sections;
}

/**
 * The first start in a project, when this machine already has a global
 * configuration: offer it rather than starting from the defaults again.
 * Nothing is asked when there is no global copy to take, which is the normal
 * case on a machine that has never synced one.
 */
export async function offerGlobal(target) {
  if (!firstRun(target)) return;
  const stored = readGlobal();
  if (!stored) return;

  // Nothing to answer with in CI, a pipe or an editor task: stay silent and
  // leave the question for a real terminal.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const saved = new Date(stored.file.exportedAt ?? "");
  console.log(`\n  This machine has a global configuration: ${stored.sections.join(", ")}.`);
  console.log(`    ${globalFile}${Number.isNaN(saved.getTime()) ? "" : `  saved ${saved.toLocaleString()}`}`);
  console.log("  It can be synced again any time from Settings > Backup.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = (await rl.question("\n  Import it into this project? [Y/n] ")).trim().toLowerCase();
  } finally {
    rl.close();
  }

  if (answer === "n" || answer === "no") {
    answered(target, false);
    console.log("  global    skipped. Sync from it any time in Settings > Backup.");
    return;
  }
  importGlobal(target, stored);
  answered(target, true);
}
