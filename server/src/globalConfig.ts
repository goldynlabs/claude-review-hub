import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyBackup,
  buildBackup,
  BACKUP_KIND,
  BACKUP_SECTIONS,
  sectionsIn,
  type Backup,
  type BackupSection,
} from "./backup.js";

/**
 * One copy of the configuration for the whole machine, outside any repo. The
 * tool is installed per project, so without this every checkout starts from the
 * defaults again; with it a project is one question away from the setup its
 * owner already settled on. It is the very file an export writes, so the two
 * are the same document in two places rather than two formats.
 */
export const globalDir = path.join(os.homedir(), ".claude-review-hub");
export const globalFile = path.join(globalDir, "settings.json");

/** What the dashboard needs to say whether there is anything to sync from. */
export interface GlobalState {
  path: string;
  exists: boolean;
  /** Which sections the stored copy carries, which may not be all three. */
  sections: BackupSection[];
  savedAt?: string;
  tool?: string;
}

export function readGlobal(): Backup | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(globalFile, "utf8")) as Partial<Backup>;
    if (parsed?.kind !== BACKUP_KIND || !sectionsIn(parsed).length) return null;
    return parsed as Backup;
  } catch {
    // Missing, unreadable or written by something else: there is no global
    // copy, which is what a machine that has never saved one looks like.
    return null;
  }
}

export function globalState(): GlobalState {
  const stored = readGlobal();
  if (!stored) return { path: globalFile, exists: false, sections: [] };
  return {
    path: globalFile,
    exists: true,
    sections: sectionsIn(stored),
    savedAt: stored.exportedAt,
    tool: stored.tool,
  };
}

/**
 * Sync to global. Only the chosen sections are written, and the ones already
 * there that were not chosen stay: syncing settings alone should not quietly
 * take the profiles off every other project's offer.
 */
export function saveGlobal(sections?: unknown): GlobalState {
  const fresh = buildBackup(sections);
  const stored = readGlobal();
  const kept = BACKUP_SECTIONS.filter((section) => !fresh.sections.includes(section) && stored?.[section] !== undefined);
  const merged: Backup = {
    ...fresh,
    sections: BACKUP_SECTIONS.filter((section) => fresh.sections.includes(section) || kept.includes(section)),
    ...Object.fromEntries(kept.map((section) => [section, stored?.[section]])),
  };
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(globalFile, JSON.stringify(merged, null, 2), "utf8");
  return globalState();
}

/** Sync from global: the same replacement an imported file would make. */
export function loadGlobal(sections?: unknown): BackupSection[] {
  const stored = readGlobal();
  if (!stored) throw new Error("Nothing has been saved to the global configuration on this machine yet.");
  return applyBackup(stored, sections);
}
