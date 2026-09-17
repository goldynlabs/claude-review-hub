#!/usr/bin/env node
import cors from "cors";
import express from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { api } from "./routes.js";
import { ensureLayout, projectRoot } from "./paths.js";
import { webDist } from "./pkg.js";
import { effectiveContext, registerRepo, setDetectedContext } from "./config.js";
import { detectContext, providerFor } from "./providers/index.js";
import { pruneWorktrees } from "./git/worktree.js";
import { ensureSkills } from "./skill.js";
import { ensureClisOnPath } from "./providers/cliPath.js";
import { resetRunningSessions } from "./sessions.js";
import { db } from "./db.js";
import { markReady } from "./boot.js";

const port = Number(process.env.PORT ?? 4319);

ensureLayout();

// A turn dies with the process it ran in, so nothing is left running here.
const stranded = resetRunningSessions();

// Before anything asks a CLI a question: a terminal opened before `gh` or `az`
// was installed still has the old PATH, and so does everything it spawned.
const repairedPath = ensureClisOnPath();

// The repo the tool was launched from is always reviewable without extra setup.
// A workspace folder is not one, and registering it under its own name would
// point the agent at a directory with no remote and no branches.
if (fs.existsSync(path.join(projectRoot, ".git"))) {
  registerRepo(path.basename(projectRoot), projectRoot);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/api", api);

// In production the built dashboard is served from the same origin.
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

// Nothing may leave this server as an HTML error page: a malformed body or a
// crash outside the API router lands here instead.
app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[server] ${req.method} ${req.originalUrl}:`, error?.stack ?? error);
  if (!res.headersSent) res.status(error?.status ?? 500).json({ error: error?.message ?? "Unexpected server error." });
});

process.on("unhandledRejection", (reason) => console.error("[unhandled]", reason));

/**
 * Reviewing several repos at once is normal, so a taken port is not an error:
 * the next free one is used and the banner says which.
 */
function listen(from: number, attempts = 20): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const tryPort = (candidate: number, left: number) => {
      const server = app.listen(candidate);
      server.once("listening", () => resolve({ server, port: candidate }));
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EADDRINUSE") return reject(error);
        if (left <= 0) {
          return reject(
            new Error(
              attempts === 1
                ? `Port ${from} is in use. Stop whatever holds it, or pass --api-port.`
                : `Ports ${from} to ${from + attempts - 1} are all in use.`,
            ),
          );
        }
        tryPort(candidate + 1, left - 1);
      });
    };
    tryPort(from, attempts - 1);
  });
}

// In dev the launcher already picked this port and told Vite to proxy to it,
// so quietly moving to the next one would leave the dashboard talking to
// something else. There, a taken port has to fail instead.
const { server, port: actualPort } = await listen(port, process.env.REVIEW_TOOL_STRICT_PORT ? 1 : 20).catch((error: Error) => {
  console.error(`\n  The server could not start: ${error.message}\n`);
  process.exit(1);
});

// The host, the organisation and the real repo name all come from the origin
// remote, so there is nothing to type in before the first review.
const detected = await detectContext();
setDetectedContext(detected);
if (detected.repo) registerRepo(detected.repo, projectRoot);

// The agent follows a skill to do its work, so it must exist before any run.
const skills = await ensureSkills();
markReady();

const context = effectiveContext();
const origin =
  context.source === "git-remote"
    ? " (from origin remote)"
    : context.source === "cli-defaults"
      ? " (from the CLI defaults)"
      : "";
console.log(`\n  ✳️  Claude Review Hub`);
console.log(`  project : ${projectRoot}`);
for (const installed of skills) {
  if (installed.state === "installed" || installed.state === "updated") {
    console.log(`  skill   : ${installed.skill} ${installed.state}`);
  }
}
if (repairedPath.length) console.log(`  path    : found ${repairedPath.join(", ")} outside this terminal PATH`);
if (stranded) console.log(`  note    : ${stranded} session(s) were mid-turn when the tool last stopped`);
console.log(`  host    : ${context.provider ? providerFor(context.provider).label : "(none yet, paste a full PR URL)"}`);
if (context.org) console.log(`  org     : ${context.org}${origin}`);
// In dev this port serves the API, and the page to open is Vite's, which the
// launcher printed. Calling it "url" here sends you to the last build instead.
const underDevLauncher = Boolean(process.env.REVIEW_TOOL_DEV);
console.log(
  `  ${underDevLauncher ? "api    " : "url    "} : http://localhost:${actualPort}${
    actualPort !== port ? `  (${port} was in use)` : ""
  }`,
);
if (underDevLauncher) console.log(`  open    : http://localhost:${process.env.WEB_PORT ?? "4318"}`);
// The dashboard lives as long as this terminal does, so say so plainly.
console.log(`\n  Keep this terminal open. Press Ctrl+C to stop the dashboard.\n`);

pruneWorktrees()
  .then((removed) => removed.length && console.log(`  pruned ${removed.length} stale worktree(s)`))
  .catch(() => undefined);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log("\n  Stopping the dashboard...");
    server.close(() => {
      db.close();
      console.log("  Stopped.\n");
      process.exit(0);
    });
    // A held-open SSE stream must not keep the terminal hostage.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
