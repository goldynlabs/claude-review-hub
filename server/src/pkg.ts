import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tool's own install directory, found by looking for the skill it ships.
 * Counting `..` from this file instead would break the moment the code is run
 * from source, from `server/dist`, or from an npx cache, which are all normal.
 */
function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, "skill", "azure-pr-master", "SKILL.md"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find the tool's own files. The install looks incomplete; reinstall claude-review-hub.");
}

export const packageRoot = findPackageRoot();
/** The folder the per-host skills live in, one directory per skill. */
export const skillSource = path.join(packageRoot, "skill");
export const webDist = path.join(packageRoot, "web", "dist");
