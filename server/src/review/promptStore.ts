import fs from "node:fs";
import path from "node:path";
import { configDir } from "../paths.js";

const overridesFile = path.join(configDir, "prompts.json");

/**
 * Rewritten action templates, by action id. The templates in the code are the
 * defaults; anything here replaces one of them everywhere it is used, which is
 * the hover, the confirmation and what is finally sent, because all three are
 * built from the same string.
 */
function read(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(overridesFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => [key, String(value)]),
    );
  } catch {
    // Missing or unreadable: there are no overrides, which is the normal case.
    return {};
  }
}

function write(overrides: Record<string, string>): void {
  fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
  fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), "utf8");
}

export function listPromptOverrides(): Record<string, string> {
  return read();
}

export function getPromptOverride(actionId: string): string | undefined {
  return read()[actionId];
}

/** An empty template would send nothing, so saving one resets to the default. */
export function savePromptOverride(actionId: string, template: string): string | null {
  const overrides = read();
  if (!template.trim()) {
    delete overrides[actionId];
    write(overrides);
    return null;
  }
  overrides[actionId] = template;
  write(overrides);
  return template;
}

export function resetPromptOverride(actionId: string): void {
  const overrides = read();
  delete overrides[actionId];
  write(overrides);
}
