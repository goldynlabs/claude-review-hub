import {
  defaultSettings,
  getSettings,
  machineSettingKeys,
  replaceSettings,
  type Settings,
} from "./config.js";
import { toolVersion } from "./paths.js";
import { listProfiles, replaceProfiles, resetProfiles } from "./review/profiles.js";
import {
  clearPromptOverrides,
  listPromptOverrides,
  replacePromptOverrides,
} from "./review/promptStore.js";
import type { Profile } from "./review/schema.js";

/**
 * Everything Settings can configure lives in three files under
 * `.review-tool/config`, so a backup is those three and nothing else. Sessions,
 * findings and worktrees are a record of work rather than configuration: they
 * are never in a backup and never touched by an import or a restore.
 */
export const BACKUP_SECTIONS = ["settings", "profiles", "prompts"] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];

/** Recognised on import so a file from somewhere else is refused by name. */
export const BACKUP_KIND = "claude-review-hub-settings";

export interface Backup {
  kind: typeof BACKUP_KIND;
  /** The shape of this file, not the tool's version. */
  format: 1;
  /** The tool that wrote it, for a reader wondering how old the file is. */
  tool: string;
  exportedAt: string;
  sections: BackupSection[];
  settings?: Partial<Settings>;
  profiles?: Profile[];
  prompts?: Record<string, string>;
}

function isSection(value: unknown): value is BackupSection {
  return BACKUP_SECTIONS.includes(value as BackupSection);
}

/** The chosen sections, or all of them, in the order they are declared. */
function chosen(sections?: unknown): BackupSection[] {
  if (!Array.isArray(sections)) return [...BACKUP_SECTIONS];
  const picked = sections.filter(isSection);
  return BACKUP_SECTIONS.filter((section) => picked.includes(section));
}

/** Settings minus the ones that only mean something on this machine. */
function portableSettings(): Partial<Settings> {
  const settings = getSettings() as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(defaultSettings)
      .filter((key) => !machineSettingKeys.includes(key as (typeof machineSettingKeys)[number]))
      .map((key) => [key, settings[key]]),
  ) as Partial<Settings>;
}

export function buildBackup(sections?: unknown): Backup {
  const picked = chosen(sections);
  return {
    kind: BACKUP_KIND,
    format: 1,
    tool: toolVersion,
    exportedAt: new Date().toISOString(),
    sections: picked,
    ...(picked.includes("settings") ? { settings: portableSettings() } : {}),
    ...(picked.includes("profiles") ? { profiles: listProfiles() } : {}),
    ...(picked.includes("prompts") ? { prompts: listPromptOverrides() } : {}),
  };
}

/** What a file actually carries, which is what the import may be asked for. */
export function sectionsIn(file: unknown): BackupSection[] {
  const value = (file ?? {}) as Partial<Backup>;
  return BACKUP_SECTIONS.filter((section) => value[section] !== undefined);
}

function parsed(file: unknown): Backup {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("That is not a settings file.");
  }
  const value = file as Partial<Backup>;
  if (value.kind !== BACKUP_KIND) {
    throw new Error("That file was not exported from this tool.");
  }
  if (!sectionsIn(value).length) {
    throw new Error("That file has nothing in it to import.");
  }
  return value as Backup;
}

/**
 * Replacement, not a merge: each chosen section becomes exactly what the file
 * says, so importing twice lands in the same place and there is no half-state
 * to reason about. Sections the file does not carry are left alone.
 */
export function applyBackup(file: unknown, sections?: unknown): BackupSection[] {
  const backup = parsed(file);
  const available = sectionsIn(backup);
  const picked = chosen(sections).filter((section) => available.includes(section));
  if (!picked.length) throw new Error("Nothing was selected to import.");

  // Profiles first: it is the one that can refuse the file, and refusing
  // before anything is written leaves the configuration as it was.
  if (picked.includes("profiles")) replaceProfiles(backup.profiles ?? []);
  if (picked.includes("settings")) replaceSettings(backup.settings ?? {});
  if (picked.includes("prompts")) replacePromptOverrides(backup.prompts ?? {});
  return picked;
}

/**
 * Back to a fresh install's configuration. The repos registered on this
 * machine and the host last used stay: they are facts about this machine
 * rather than settings, and losing them would only mean typing them again.
 */
export function restoreDefaults(): void {
  replaceSettings({});
  resetProfiles();
  clearPromptOverrides();
}
