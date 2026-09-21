import fs from "node:fs";
import path from "node:path";
import { configDir, projectRoot } from "./paths.js";
import { EMPTY_CONTEXT, type ProviderKind, type RepoContext } from "./providers/index.js";

export type PermissionMode = "ask" | "auto";

export interface Settings {
  /**
   * Language the agent writes in for the dashboard: findings, verdicts, chat
   * replies, summaries. The prompts sent to it stay English regardless.
   */
  sessionLanguage: string;
  /** Language of anything posted to the pull request: comments, thread replies. */
  pullRequestLanguage: string;
  models: {
    /** Broad sweep over the diff. */
    review: string;
    /** Adversarial re-check of a single finding. */
    challenge: string;
    /** Free-form chat box. */
    chat: string;
  };
  /**
   * The last host and organisation that successfully resolved a PR. Written
   * automatically when a review names one, never typed in: it is what makes a
   * bare PR number work in a repo whose remote belongs to neither host, and
   * what settles which host is meant when both CLIs are signed in.
   */
  remembered: { provider: ProviderKind | ""; org: string; project: string };
  /** repo name -> absolute local path. The installed project is registered on boot. */
  repos: Record<string, string>;
  /** Claude may edit files inside the worktree (needed for auto-fix / create PR). */
  allowCodeEdits: boolean;
  /**
   * "ask": every write action and shell command is confirmed in the dashboard.
   * "auto": nothing is confirmed, the agent runs unattended.
   */
  permissionMode: PermissionMode;
  /**
   * How hard a review looks, whichever profile it runs with. A profile says
   * what to look for; these say how much machinery to spend looking, which is
   * a decision about cost rather than about criteria, so it is made once here
   * instead of once per profile.
   */
  review: {
    /** Load the target project's own rule files as part of the review standard. */
    useProjectRules: boolean;
    /** One subagent per dimension, at several times the tokens. */
    parallelDimensions: boolean;
    /** A second pass that argues with every finding before the run ends. */
    verifyFindings: boolean;
  };
  /** Delete review worktrees older than this. 0 disables pruning. */
  worktreeTtlHours: number;
  showCost: boolean;
}

const settingsFile = path.join(configDir, "settings.json");

export const defaultSettings: Settings = {
  sessionLanguage: "en",
  pullRequestLanguage: "en",
  models: {
    review: "claude-sonnet-5",
    challenge: "claude-opus-5",
    chat: "claude-opus-5",
  },
  remembered: { provider: "", org: "", project: "" },
  repos: {},
  allowCodeEdits: false,
  permissionMode: "auto",
  review: { useProjectRules: true, parallelDimensions: false, verifyFindings: false },
  worktreeTtlHours: 72,
  showCost: true,
};

let cached: Settings | null = null;

/** Filled on boot from the git remote, or from whichever CLI has defaults. */
let detected: RepoContext = EMPTY_CONTEXT;

export function setDetectedContext(value: RepoContext): void {
  detected = value;
}

export function getDetectedContext(): RepoContext {
  return detected;
}

/**
 * The repo the tool runs in comes first: its remote names the host outright, so
 * having both CLIs installed is never a guess. Only when the remote says
 * nothing does the last host that worked decide.
 */
export function effectiveContext(): RepoContext {
  if (detected.provider && detected.org) return detected;
  const { remembered } = getSettings();
  if (remembered.provider && remembered.org) {
    return { ...remembered, provider: remembered.provider, repo: detected.repo, source: "none" };
  }
  return detected;
}

export function rememberContext(value: { provider: ProviderKind; org: string; project?: string }): void {
  const current = getSettings().remembered;
  if (!value.org) return;
  const next = { provider: value.provider, org: value.org, project: value.project ?? "" };
  if (current.provider === next.provider && current.org === next.org && current.project === next.project) return;
  saveSettings({ remembered: next });
}

export function getSettings(): Settings {
  if (cached) return cached;
  let stored: Partial<Settings> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      stored = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    } catch {
      stored = {};
    }
  }
  // Older installs stored one outputLanguage for both the dashboard and the PR,
  // and later an azureLanguage, from when Azure DevOps was the only host.
  const legacyLang = stored as { outputLanguage?: string; azureLanguage?: string };
  if (legacyLang.outputLanguage) {
    if (!stored.sessionLanguage) stored.sessionLanguage = legacyLang.outputLanguage;
    if (!legacyLang.azureLanguage) legacyLang.azureLanguage = legacyLang.outputLanguage;
    delete legacyLang.outputLanguage;
  }
  if (legacyLang.azureLanguage) {
    if (!stored.pullRequestLanguage) stored.pullRequestLanguage = legacyLang.azureLanguage;
    delete legacyLang.azureLanguage;
  }

  // Older installs remembered an organisation with no host beside it, which
  // could only ever have been an Azure DevOps one.
  const legacyOrg = stored as { rememberedOrg?: string };
  if (legacyOrg.rememberedOrg) {
    if (!stored.remembered) {
      stored.remembered = { provider: "azure", org: legacyOrg.rememberedOrg, project: "" };
    }
    delete legacyOrg.rememberedOrg;
  }

  // Older installs stored this as writeActions: "confirm" | "allow".
  const legacy = stored as { writeActions?: string };
  if (legacy.writeActions) {
    if (!stored.permissionMode) stored.permissionMode = legacy.writeActions === "allow" ? "auto" : "ask";
    delete legacy.writeActions;
  }

  // Only known keys survive, so a setting that is removed from the tool stops
  // being served from an old settings.json as if it still meant something.
  const merged = { ...defaultSettings, ...stored } as Record<string, unknown>;
  cached = Object.fromEntries(
    Object.keys(defaultSettings).map((key) => [key, merged[key]]),
  ) as unknown as Settings;
  cached.models = { ...defaultSettings.models, ...(stored.models ?? {}) };
  cached.remembered = { ...defaultSettings.remembered, ...(stored.remembered ?? {}) };
  cached.repos = { ...(stored.repos ?? {}) };
  cached.review = { ...defaultSettings.review, ...(stored.review ?? {}) };
  return cached;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = {
    ...getSettings(),
    ...patch,
    models: { ...getSettings().models, ...(patch.models ?? {}) },
    remembered: { ...getSettings().remembered, ...(patch.remembered ?? {}) },
    repos: patch.repos ?? getSettings().repos,
    review: { ...getSettings().review, ...(patch.review ?? {}) },
  };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return next;
}

export function registerRepo(repo: string, localPath: string): void {
  const settings = getSettings();
  saveSettings({ repos: { ...settings.repos, [repo]: localPath } });
}

/** Turns "vi" or "Vietnamese" into the words the agent reads. */
function named(lang: string): string {
  return lang.trim() || "English";
}

/**
 * Two languages, because the dashboard and the pull request have different
 * readers: what the agent reports here, and what it posts to the host, are set
 * apart. The prompts themselves are always English and say nothing about it.
 */
export function languageInstructions(): string[] {
  const { sessionLanguage, pullRequestLanguage } = getSettings();
  return [
    `Write everything you report to the dashboard in ${named(sessionLanguage)}: findings, verdicts, summaries and your replies in chat.`,
    `Write everything you post to a pull request in ${named(pullRequestLanguage)}: inline comments, general comments, thread replies and review votes.`,
  ];
}

/**
 * The settings that are not worth carrying to another machine: where each repo
 * sits on this disk, and which host last resolved a pull request. A backup
 * leaves them out, and an import or a restore leaves the ones already here
 * alone, so moving a configuration never points the tool at a path that does
 * not exist.
 */
export const machineSettingKeys = ["repos", "remembered"] as const;

/**
 * Wholesale replacement rather than a patch: what is not in `values` goes back
 * to its default instead of keeping whatever was there. This is what an import
 * means, and what a restore with no values means.
 */
export function replaceSettings(values: Partial<Settings>): Settings {
  const current = getSettings();
  const known = Object.fromEntries(
    Object.keys(defaultSettings)
      .filter((key) => key in values)
      .map((key) => [key, (values as Record<string, unknown>)[key]]),
  ) as Partial<Settings>;
  const next: Settings = {
    ...defaultSettings,
    ...known,
    models: { ...defaultSettings.models, ...(known.models ?? {}) },
    review: { ...defaultSettings.review, ...(known.review ?? {}) },
    repos: current.repos,
    remembered: current.remembered,
  };
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), "utf8");
  cached = next;
  return next;
}
