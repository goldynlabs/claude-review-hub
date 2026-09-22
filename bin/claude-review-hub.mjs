#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installSkill, isUsableTarget } from "../scripts/install-skill.mjs";
import { importGlobal, offerGlobal } from "../scripts/offer-global.mjs";
import { importProfiles, offerProfiles } from "../scripts/offer-profiles.mjs";
import { uninstallTool } from "../scripts/uninstall.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "server", "dist", "index.js");
const cliEntry = path.join(here, "..", "server", "dist", "cli.js");

const args = process.argv.slice(2);
const COMMANDS = ["install", "uninstall", "version", "review"];
const command = COMMANDS.includes(args[0]) ? args[0] : "start";

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
  claude-review-hub [command] [repo path] [options]

  The repo path is where the review happens. It defaults to the current
  directory, so inside a repo 'claude-review-hub' on its own is enough.

  (no command)   Open the dashboard for that repo
  install        Only install the skill and the git exclude entries
  review <pr>    Review a pull request in this terminal and print what it
                 found, then leave the session for the dashboard. The repo is
                 --project or the current directory, so what follows 'review'
                 is the pull request: a URL, a number, or a sentence naming
                 several. Exit code 0 found nothing, 1 has findings, 2 could
                 not run. Needs Settings > Permissions on auto, and it edits
                 no code unless the project already allows code edits.
  uninstall      Remove them again (add --purge to delete .review-tool/ as
                 well: sessions, findings and review worktrees)
  version        Print the tool version

  --port <n>     Preferred port (default 4319). If it is taken, the next
                 free one is used.
  --profile <id> Review with that profile, for 'review'. Without one the
                 --note is the whole brief, as in the dashboard.
  --note <text>  What the reviewer is asking for, for 'review'.
  --json         Print the findings as JSON, for 'review'.
  --profiles     Import the ready-made review profiles without asking, in a
                 project that was never asked or that said no. The shipped
                 ones are rewritten; your own profiles are untouched.
  --no-profiles  Skip the first-run question about importing them.
  --global       Take this machine's global configuration without asking, if
                 there is one. Written from Settings > Backup > Sync to global.
  --no-global    Skip the first-run question about taking it.

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

/** The repo to review: boolean flags do not consume the path after them. */
const valueFlags = new Set(["--project", "--port"]);
const consumed = new Set();
for (let index = 0; index < args.length; index += 1) {
  if (valueFlags.has(args[index])) consumed.add(index + 1);
}
// After 'review' the words are the pull request, not a path: there the repo
// is --project or the directory the command was run in.
const positional =
  command === "review"
    ? undefined
    : args.find((arg, index) => !arg.startsWith("-") && !COMMANDS.includes(arg) && !consumed.has(index));
const target = path.resolve(flag("--project") ?? positional ?? process.cwd());

if (command === "version") {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

if (!isUsableTarget(target)) {
  console.error(`
  ${target} is not a folder.
  Pass a checkout, or a folder that holds some: npx claude-review-hub <path>
`);
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

// Asked before the server starts, so the first dashboard already has them.
// Both are one-time questions per project; see the scripts they live in.
//
// The global configuration comes first: a project that takes it has its
// profiles already, so the question about the ready-made ones stays quiet.
//
// A headless review answers nothing on a terminal that may be a script, so it
// takes what is already configured and asks its first-run questions the next
// time the dashboard opens.
if (command !== "review") {
  if (args.includes("--global")) importGlobal(target);
  else if (!args.includes("--no-global")) await offerGlobal(target);

  if (args.includes("--profiles")) importProfiles(target);
  else if (!args.includes("--no-profiles")) await offerProfiles(target);
}

if (command === "install") {
  console.log(`\n  Ready. Run 'npx claude-review-hub' in that repo to open the dashboard.\n`);
  process.exit(0);
}

// The review runs from a second entry rather than the server's: the dashboard
// is a server that happens to review, and this is a review with no server.
const entry = command === "review" ? cliEntry : serverEntry;

if (!fs.existsSync(entry)) {
  console.error(`\n  The tool has not been built yet.\n  Run 'npm run build' in ${path.join(here, "..")}\n`);
  process.exit(1);
}

const port = flag("--port");
if (port) process.env.PORT = port;
process.env.REVIEW_TOOL_PROJECT = target;

await import(new URL(`file://${entry.replace(/\\/g, "/")}`));
