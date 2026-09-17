#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installSkill, isGitRepo } from "../scripts/install-skill.mjs";
import { uninstallTool } from "../scripts/uninstall.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "server", "dist", "index.js");

const args = process.argv.slice(2);
const COMMANDS = ["install", "uninstall", "version"];
const command = COMMANDS.includes(args[0]) ? args[0] : "start";

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
  claude-review-hub [command] [repo path] [options]

  The repo path is where the review happens. It defaults to the current
  directory, so inside a repo 'claude-review-hub' on its own is enough.

  (no command)   Open the dashboard for that repo
  install        Only install the skill and the git exclude entries
  uninstall      Remove them again (add --purge to delete .review-tool/ as
                 well: sessions, findings and review worktrees)
  version        Print the tool version

  --port <n>     Preferred port (default 4319). If it is taken, the next
                 free one is used.

  Examples:
    npx claude-review-hub "C:\\Source code\\your-repo"
    cd your-repo && npx claude-review-hub
`);
  process.exit(0);
}

function flag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** The repo to review: the first bare argument that is not a flag's value. */
const positional = args.find(
  (arg, index) => !arg.startsWith("-") && !COMMANDS.includes(arg) && !args[index - 1]?.startsWith("-"),
);
const target = path.resolve(flag("--project") ?? positional ?? process.cwd());

if (command === "version") {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

if (!isGitRepo(target)) {
  console.error(`\n  ${target} is not a git repository.\n  Pass the repo to review: npx claude-review-hub <path>\n`);
  process.exit(1);
}

console.log(`\n  ${path.basename(target)}`);

if (command === "uninstall") {
  uninstallTool(target, { purge: args.includes("--purge") });
  console.log("");
  process.exit(0);
}

// One command does the whole thing: the skill is (re)installed on every start,
// so an updated tool never leaves a stale skill behind in a project.
installSkill(target);

if (command === "install") {
  console.log(`\n  Ready. Run 'npx claude-review-hub' in that repo to open the dashboard.\n`);
  process.exit(0);
}

if (!fs.existsSync(serverEntry)) {
  console.error(`\n  The tool has not been built yet.\n  Run 'npm run build' in ${path.join(here, "..")}\n`);
  process.exit(1);
}

const port = flag("--port");
if (port) process.env.PORT = port;
process.env.REVIEW_TOOL_PROJECT = target;

await import(new URL(`file://${serverEntry.replace(/\\/g, "/")}`));
