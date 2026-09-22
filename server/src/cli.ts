#!/usr/bin/env node
/**
 * The review the dashboard runs, without the dashboard.
 *
 * Same session store, same prompt, same worktrees: this entry only replaces
 * the browser with a terminal, so a session it leaves behind opens in the
 * dashboard like any other. Nothing here reviews differently.
 *
 * It runs unattended, which is only honest while `permissionMode` is "auto",
 * the default. In "ask" mode every confirmation belongs to a dashboard nobody
 * is watching, so this refuses to start rather than answer on the reviewer's
 * behalf.
 */
import { markReady } from "./boot.js";
import { effectiveContext, getSettings, registerRepo, setDetectedContext } from "./config.js";
import { db } from "./db.js";
import { listEvents, subscribe } from "./events.js";
import { ensureLayout, projectRoot } from "./paths.js";
import { detectContext, providerFor } from "./providers/index.js";
import { ensureClisOnPath } from "./providers/cliPath.js";
import { findClaudeCode } from "./claudeCode.js";
import { runAction } from "./review/actions.js";
import { listFindings } from "./review/findings.js";
import { listProfiles } from "./review/profiles.js";
import { ensureSkills } from "./skill.js";
import { createSession, listSessionPrs, resetRunningSessions } from "./sessions.js";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const args = argv[0] === "review" ? argv.slice(1) : argv;

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const valueFlags = new Set(["--profile", "--note", "--project", "--port"]);
const consumed = new Set<number>();
for (const [index, arg] of args.entries()) if (valueFlags.has(arg)) consumed.add(index + 1);

/** Whatever is left over is the review request, in the reviewer's own words. */
const request = args
  .filter((arg, index) => !arg.startsWith("-") && !consumed.has(index))
  .join(" ")
  .trim();

const asJson = args.includes("--json");

function fail(message: string, code = 2): never {
  console.error(`\n  ${message}\n`);
  process.exit(code);
}

if (!request) {
  fail("Nothing to review. Pass a pull request: claude-review-hub review <pr url or number>");
}

if (!findClaudeCode()) {
  fail("Claude Code is not installed here. Install it with 'npm i -g @anthropic-ai/claude-code', then sign in with 'claude'.");
}

ensureLayout();
resetRunningSessions();
ensureClisOnPath();

if (fs.existsSync(path.join(projectRoot, ".git"))) {
  registerRepo(path.basename(projectRoot), projectRoot);
}

const settings = getSettings();
if (settings.permissionMode === "ask") {
  fail(
    "This project confirms every tool call in the dashboard, so a headless review would wait for a page nobody has open.\n  Set Settings > Permissions to auto, or run the dashboard instead: claude-review-hub",
  );
}

const profileId = flag("--profile");
if (profileId && !listProfiles().some((profile) => profile.id === profileId)) {
  fail(`Unknown review profile: ${profileId}. Available: ${listProfiles().map((profile) => profile.id).join(", ")}`);
}

const detected = await detectContext();
setDetectedContext(detected);
if (detected.repo) registerRepo(detected.repo, projectRoot);
await ensureSkills();
markReady();

const context = effectiveContext();
const session = createSession({ title: request.slice(0, 80), profileId });

if (!asJson) {
  console.log(`\n  ✳️  Claude Review Hub`);
  console.log(`  project : ${projectRoot}`);
  console.log(`  host    : ${context.provider ? providerFor(context.provider).label : "(none yet, pass a full PR URL)"}`);
  console.log(`  profile : ${profileId ?? "(none: the note is the whole brief)"}`);
  console.log(`  session : ${session.id}\n`);
}

// The turn is long and quiet, so what the agent reaches for is worth showing:
// a review that is stuck on a `gh` call looks the same as one that hung.
const unsubscribe = subscribe(session.id, (event) => {
  if (asJson) return;
  if (event.type === "tool.used") {
    const payload = event.payload as { name?: string; input?: { command?: string } };
    const detail = payload.input?.command ?? "";
    console.log(`  · ${payload.name}${detail ? ` ${detail.replace(/\s+/g, " ").slice(0, 70)}` : ""}`);
  }
});

let failure: Error | null = null;
await runAction(session.id, "review", { request, note: flag("--note") ?? "" }).catch((error: unknown) => {
  failure = error instanceof Error ? error : new Error(String(error));
});
unsubscribe();

const findings = listFindings(session.id).filter((finding) => !finding.superseded);
const events = listEvents(session.id);
const closing = events.filter((event) => event.type === "assistant.text").at(-1);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        sessionId: session.id,
        prs: listSessionPrs(session.id).map(({ id, prId, repo, title, state }) => ({ id, prId, repo, title, state })),
        findings,
        closing: (closing?.payload as { text?: string } | undefined)?.text ?? "",
        error: failure ? String(failure) : null,
      },
      null,
      2,
    ),
  );
} else {
  if (closing) console.log(`\n${(closing.payload as { text?: string }).text ?? ""}\n`);
  for (const finding of findings) {
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.log(`  [${finding.severity}] ${where}  ${finding.title}`);
  }
  console.log(`\n  ${findings.length} finding(s). Open the session with 'claude-review-hub' to reply to them.\n`);
  if (failure) console.error(`  The review did not finish: ${String(failure)}\n`);
}

db.close();
// Findings are the reason to run this in a script, so they decide the exit
// code: 0 clean, 1 something to look at, 2 the review could not run at all.
process.exit(failure ? 2 : findings.length ? 1 : 0);
