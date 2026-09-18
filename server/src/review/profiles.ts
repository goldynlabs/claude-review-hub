import fs from "node:fs";
import path from "node:path";
import { configDir } from "../paths.js";
import { profileSchema, type Profile } from "./schema.js";

const profilesFile = path.join(configDir, "profiles.json");

/**
 * Review criteria live here, not in a skill: the point of the tool is that the
 * scope and the extra context are configured per run from the UI.
 */
export const builtInProfiles: Profile[] = [
  {
    id: "default",
    name: "General review",
    dimensions: [
      {
        id: "correctness",
        label: "Correctness",
        enabled: true,
        prompt:
          "Logic errors, wrong conditions, off-by-one, unhandled null/undefined, broken contracts between caller and callee, race conditions. Give a concrete input or state that produces the wrong result.",
      },
      {
        id: "security",
        label: "Security",
        enabled: true,
        prompt:
          "Injection, missing authorisation checks, secrets in code, unsafe deserialisation, data exposed to the wrong user.",
      },
      {
        id: "regression",
        label: "Blast radius",
        enabled: true,
        prompt:
          "Callers of every changed signature or behaviour. Flag call sites the PR did not update. Cite the call sites you found.",
      },
      {
        id: "rules",
        label: "Project rules",
        enabled: true,
        prompt:
          "Violations of the project's own documented conventions. Quote the rule you are applying; do not invent conventions.",
      },
    ],
    context: "",
    include: [],
    exclude: ["**/*.snap", "**/*.lock", "**/package-lock.json"],
    severityFloor: "suggestion",
    confidenceFloor: 0,
  },
];

/**
 * Not a profile, and deliberately not in the list: the option that asks a
 * Claude of its own which profile each pull request should be reviewed
 * against. It is stored on the session where a profile id goes, so the id has
 * a shape no saved profile can take.
 */
export const AUTO_PROFILE_ID = "@auto";

export function isAutoProfile(id: string | null | undefined): boolean {
  return id === AUTO_PROFILE_ID;
}

/**
 * The profile a plain review run should use. Auto detect is not one, so a
 * button that wants a single profile falls back to the first real one rather
 * than throwing at the sight of the sentinel.
 */
export function reviewProfile(id: string | null | undefined): Profile {
  if (!id || isAutoProfile(id)) return listProfiles()[0] ?? getProfile("default");
  return getProfile(id);
}

function readStore(): Profile[] {
  if (!fs.existsSync(profilesFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(profilesFile, "utf8")) as unknown[];
    return parsed.map((item) => profileSchema.parse(item));
  } catch {
    return [];
  }
}

function writeStore(profiles: Profile[]): void {
  fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2), "utf8");
}

export function listProfiles(): Profile[] {
  const custom = readStore();
  const customIds = new Set(custom.map((profile) => profile.id));
  return [...builtInProfiles.filter((profile) => !customIds.has(profile.id)), ...custom];
}

export function getProfile(id: string): Profile {
  const profile = listProfiles().find((item) => item.id === id);
  if (!profile) throw new Error(`Unknown review profile: ${id}`);
  return profile;
}

export function saveProfile(input: unknown): Profile {
  const profile = profileSchema.parse(input);
  const custom = readStore().filter((item) => item.id !== profile.id);
  writeStore([...custom, profile]);
  return profile;
}

/**
 * The last profile stays: a session has to be reviewed against something.
 * Built-ins come back whenever the store does not override them, so deleting
 * one means writing the profiles that remain - including the untouched
 * built-ins - into the store, or the deleted one would reappear.
 */
export function deleteProfile(id: string): void {
  const profiles = listProfiles();
  if (!profiles.some((profile) => profile.id === id)) throw new Error(`Unknown review profile: ${id}`);
  if (profiles.length <= 1) throw new Error("The last review profile cannot be deleted.");
  writeStore(profiles.filter((profile) => profile.id !== id));
}
