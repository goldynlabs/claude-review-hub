import fs from "node:fs";
import path from "node:path";

/**
 * Where each CLI installs itself, for the case its directory is not on our PATH.
 * Installing a CLI does not change the environment of a process that is already
 * running, and a terminal opened before the install keeps the old PATH for as
 * long as it lives: every child, including this server and the agent's own
 * shell, inherits it. Rather than tell the reviewer to restart the terminal, we
 * look where the installer puts things.
 */
const KNOWN_LOCATIONS: Record<string, string[]> = {
  gh: [
    "C:/Program Files/GitHub CLI",
    "C:/Program Files (x86)/GitHub CLI",
    `${process.env.LOCALAPPDATA ?? ""}/Programs/GitHub CLI`,
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
  ],
  az: [
    "C:/Program Files/Microsoft SDKs/Azure/CLI2/wbin",
    "C:/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin",
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
  ],
};

/** The names an executable goes by, so Windows wrappers are found as well. */
function candidates(cli: string): string[] {
  return process.platform === "win32" ? [`${cli}.exe`, `${cli}.cmd`, `${cli}.bat`] : [cli];
}

/**
 * Looked up on disk rather than by running the thing. Asking a shell to run a
 * command that is not there costs seconds on Windows, once per CLI, and this
 * runs before the server accepts its first request.
 */
function directoryOf(cli: string, directories: string[]): string | null {
  for (const directory of directories) {
    if (!directory) continue;
    for (const name of candidates(cli)) {
      try {
        if (fs.existsSync(path.join(directory, name))) return path.normalize(directory);
      } catch {
        // An unreadable entry on PATH is not worth failing start-up over.
      }
    }
  }
  return null;
}

/**
 * Makes every CLI this tool knows reachable, and says which ones had to be
 * found rather than inherited. Prepending to `process.env.PATH` is what fixes
 * the agent too: its shell commands are spawned from this process.
 */
export function ensureClisOnPath(): string[] {
  const onPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const repaired: string[] = [];

  for (const [cli, locations] of Object.entries(KNOWN_LOCATIONS)) {
    if (directoryOf(cli, onPath)) continue;
    const found = directoryOf(cli, locations);
    if (!found) continue;
    process.env.PATH = `${found}${path.delimiter}${process.env.PATH ?? ""}`;
    repaired.push(`${cli} (${found})`);
  }
  return repaired;
}
