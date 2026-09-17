import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Claude Code itself: this tool drives the one already on the machine rather
 * than a second copy of its own.
 *
 * The Agent SDK ships a platform binary as an optional dependency, and it is
 * the same ~230 MB executable a Claude Code user already has. Pointing the SDK
 * at theirs means `--omit=optional` installs a fifth of the package with
 * nothing missing, and it keeps the reviewing agent on the same version they
 * use everywhere else.
 */
const KNOWN_LOCATIONS = [
  `${process.env.APPDATA ?? ""}/npm/node_modules/@anthropic-ai/claude-code/bin`,
  `${process.env.LOCALAPPDATA ?? ""}/npm/node_modules/@anthropic-ai/claude-code/bin`,
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin",
  "/usr/lib/node_modules/@anthropic-ai/claude-code/bin",
  "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin",
];

const BINARY = process.platform === "win32" ? "claude.exe" : "claude";

/**
 * The real executable, never the shim. `claude` on PATH is a `.cmd` on Windows
 * and a shell script elsewhere; the SDK spawns it without a shell, which fails
 * with EINVAL on the first and loses the arguments on the second.
 */
function fromNpmGlobal(): string | null {
  for (const directory of KNOWN_LOCATIONS) {
    if (!directory) continue;
    const candidate = path.join(directory, BINARY);
    if (fs.existsSync(candidate)) return path.normalize(candidate);
  }
  return null;
}

/** Wherever npm puts its global packages on this machine, if it will say. */
function fromNpmRoot(): string | null {
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      shell: true,
      windowsHide: true,
    }).trim();
    const candidate = path.join(root, "@anthropic-ai", "claude-code", "bin", BINARY);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

let cached: string | null | undefined;

/** The path to hand the SDK, or null when Claude Code is not installed here. */
export function findClaudeCode(): string | null {
  if (cached !== undefined) return cached;
  cached = fromNpmGlobal() ?? fromNpmRoot();
  return cached;
}

export class ClaudeCodeMissing extends Error {
  constructor() {
    super(
      "Claude Code is not installed on this machine, and this tool reviews with it rather than shipping its own copy. Install it with 'npm i -g @anthropic-ai/claude-code', sign in with 'claude', then start the dashboard again.",
    );
  }
}
