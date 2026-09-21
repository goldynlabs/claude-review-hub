import { Router, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { detectContext, getThreads, listConnections, replyToThread } from "./providers/index.js";
import { effectiveContext, getSettings, saveSettings, setDetectedContext } from "./config.js";
import { emit, listEvents, subscribe } from "./events.js";
import { fileDiff } from "./git/diff.js";
import { decide, listPending } from "./permissions.js";
import { projectRoot, toolVersion } from "./paths.js";
import { getFinding, listFindings, setFindingStatus } from "./review/findings.js";
import { deleteProfile, listProfiles, saveProfile } from "./review/profiles.js";
import { generateDimensions } from "./review/dimensions.js";
import { saveProfileChoices, suggestProfiles } from "./review/autoProfiles.js";
import { isRunning, stopSession } from "./agent.js";
import { inspect } from "./inspect.js";
import { analytics, threadStats } from "./review/analytics.js";
import { buildActionPreview, effectiveActions, runAction } from "./review/actions.js";
import { resetPromptOverride, savePromptOverride } from "./review/promptStore.js";
import { applyBackup, buildBackup, restoreDefaults } from "./backup.js";
import { sendMessage } from "./review/tasks.js";
import {
  createSession,
  deleteSession,
  getSession,
  getSessionPr,
  listSessionPrs,
  listSessions,
  prRef,
  updateSession,
} from "./sessions.js";

export const api = Router();

// Rejected promises go to the same error middleware as synchronous throws, so
// every failure answers with JSON and the same status mapping.
const wrap =
  (handler: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: NextFunction) => {
    handler(req, res).catch(next);
  };

/** Long agent turns run past the request; the client follows the event stream. */
const inBackground = (sessionId: string, work: Promise<unknown>) =>
  void work.catch((error: Error) => emit(sessionId, "run.error", { message: error.message }));

/* ------------------------------------------------------------- meta */

/**
 * What the dashboard needs to draw itself, and nothing that has to ask a CLI.
 * The accounts each host is signed in as cost a second or two of `az` and `gh`,
 * and the page has no reason to stare at a blank screen for them: it asks for
 * `/connections` once it is up.
 */
api.get(
  "/health",
  wrap(async (_req, res) => {
    const detected = await detectContext();
    setDetectedContext(detected);
    res.json({
      ok: true,
      version: toolVersion,
      projectRoot,
      project: path.basename(projectRoot),
      context: effectiveContext(),
    });
  }),
);

/** What the tool worked out on its own, so Settings can show it instead of asking. */
api.get(
  "/connections",
  wrap(async (req, res) => {
    const detected = await detectContext(undefined, req.query.refresh === "1");
    setDetectedContext(detected);
    const context = effectiveContext();
    res.json({ detected, context, connections: await listConnections(context) });
  }),
);

api.get("/settings", (_req, res) => res.json(getSettings()));
api.put("/settings", (req, res) => res.json(saveSettings(req.body)));

/** Review criteria live in the tool, not in the skill, so they are edited here. */
api.get("/profiles", (_req, res) => res.json(listProfiles()));
api.put("/profiles/:id", (req, res) => res.json(saveProfile({ ...req.body, id: req.params.id })));
/** The prompt is built and shown in the dashboard; this only runs it. */
api.post(
  "/dimensions/generate",
  wrap(async (req, res) => {
    const prompt = String(req.body?.prompt ?? "").trim();
    if (!prompt) throw new Error("Nothing to generate from.");
    res.json({ text: await generateDimensions(prompt) });
  }),
);

api.delete("/profiles/:id", (req, res) => {
  deleteProfile(req.params.id);
  res.json(listProfiles());
});

api.get("/sessions", (_req, res) => res.json(listSessions()));
api.post("/sessions", (req, res) => res.json(createSession(req.body ?? {})));

api.get("/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  res.json({
    session,
    prs: listSessionPrs(session.id),
    findings: listFindings(session.id),
    pendingPermissions: listPending(session.id),
  });
});

api.put("/sessions/:id", (req, res) => res.json(updateSession(req.params.id, req.body)));

// Deleting removes the session's own worktrees, so a turn still working in one
// has to finish or be stopped first.
api.delete("/sessions/:id", wrap(async (req, res) => {
  if (busy(req.params.id, res)) return;
  await deleteSession(req.params.id);
  res.json({ ok: true });
}));

api.get("/sessions/:id/events", (req, res) => {
  getSession(req.params.id);
  res.json(listEvents(req.params.id, Number(req.query.after ?? 0)));
});

/** Live feed: every event of the session, as it is appended. */
api.get("/sessions/:id/stream", (req, res) => {
  getSession(req.params.id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  for (const event of listEvents(req.params.id, Number(req.query.after ?? 0))) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  const unsubscribe = subscribe(req.params.id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

/**
 * The review box is free text: PR ids, URLs, or a sentence. It goes to the agent
 * as written, and the agent resolves and prepares whatever it names.
 */
/**
 * One turn at a time. A second click would queue another prompt into the same
 * Claude session, and the agent would answer both at once, badly. The chat box
 * is deliberately exempt: a message typed mid-turn is meant to queue.
 */
function busy(sessionId: string, res: Response): boolean {
  if (!isRunning(sessionId)) return false;
  res.status(409).json({
    error: "The agent is still working on the previous request. Wait for it to finish, or stop it.",
  });
  return true;
}

api.post("/sessions/:id/review", (req, res) => {
  getSession(req.params.id);
  if (busy(req.params.id, res)) return;
  inBackground(
    req.params.id,
    runAction(req.params.id, "review", {
      request: String(req.body?.request ?? ""),
      note: String(req.body?.note ?? ""),
    }),
  );
  res.status(202).json({ started: true });
});

/**
 * Auto detect, between its two turns: a Claude of its own reads the pull
 * requests this session registered and says which profile fits each. Nothing
 * is stored by asking - the answer fills a modal the reviewer corrects first.
 */
api.post(
  "/sessions/:id/profiles/suggest",
  wrap(async (req, res) => {
    getSession(req.params.id);
    res.json({
      suggestions: await suggestProfiles(
        req.params.id,
        String(req.body?.note ?? ""),
        req.body?.prompt ? String(req.body.prompt) : undefined,
      ),
    });
  }),
);

/** What the reviewer settled on in that modal, which the review is built from. */
api.put("/sessions/:id/pr-profiles", (req, res) => {
  getSession(req.params.id);
  saveProfileChoices(req.params.id, req.body?.choices ?? []);
  res.json(listSessionPrs(req.params.id));
});

api.post("/sessions/:id/chat", (req, res) => {
  getSession(req.params.id);
  // `bare` comes from a session the chat box created for itself: no standing
  // instructions, just the words that were typed.
  inBackground(req.params.id, sendMessage(req.params.id, String(req.body?.message ?? ""), Boolean(req.body?.bare)));
  res.status(202).json({ accepted: true });
});

/** Stops the turn in flight. The Claude session and its context survive. */
api.post("/sessions/:id/stop", (req, res) => {
  getSession(req.params.id);
  const stopped = stopSession(req.params.id);
  if (stopped) emit(req.params.id, "run.stopped", {});
  res.json({ stopped, running: isRunning(req.params.id) });
});

/**
 * Everything the tool has recorded, counted. Straight out of the database, so
 * the panel opens without waiting on a CLI.
 */
api.get("/analytics", (_req, res) => res.json(analytics()));

/**
 * Comment thread counts for every pull request. Without `live=1` these come
 * from the `pr_threads` cache and may be stale or missing; with it, each pull
 * request is read from its host, which is what the panel asks for once it is up.
 */
api.get(
  "/analytics/threads",
  wrap(async (req, res) => {
    res.json(await threadStats(req.query.live === "1"));
  }),
);

/** Everything the agent is given: tools, prompts, permission rules, profiles. */
api.get("/inspect", (_req, res) => res.json(inspect()));

/** The prompt templates every button uses, so a tooltip can show what it sends. */
api.get("/actions", (_req, res) => res.json(effectiveActions()));

/**
 * Rewriting a template in Settings changes it everywhere at once: the hover,
 * the confirmation and what the agent is sent are all built from this string.
 * An empty body puts the built-in wording back.
 */
api.put("/prompts/:id", (req, res) => {
  const saved = savePromptOverride(req.params.id, String(req.body?.template ?? ""));
  res.json({ id: req.params.id, template: saved, actions: effectiveActions() });
});

api.delete("/prompts/:id", (req, res) => {
  resetPromptOverride(req.params.id);
  res.json({ id: req.params.id, template: null, actions: effectiveActions() });
});

/**
 * The three configuration files as one document: settings, profiles and the
 * rewritten templates. What only means something on this machine - where the
 * repos are, which host was last used - is left out, so the file can be
 * carried to another checkout without pointing it at paths that are not there.
 */
api.get("/backup", (req, res) => {
  const sections = typeof req.query.sections === "string" ? req.query.sections.split(",") : undefined;
  res.json(buildBackup(sections));
});

/** Replacement, not a merge: a chosen section becomes exactly what the file says. */
api.post("/backup/import", (req, res) => {
  const applied = applyBackup(req.body?.file, req.body?.sections);
  res.json({ applied, ...configState() });
});

/** A fresh install's configuration, keeping only what this machine knows. */
api.post("/backup/reset", (_req, res) => {
  restoreDefaults();
  res.json(configState());
});

/** Everything Settings shows, so one answer can refresh the whole dialog. */
function configState() {
  return { settings: getSettings(), profiles: listProfiles(), actions: effectiveActions() };
}

/**
 * The same preview for a prompt that has no session behind it yet: the sidebar
 * asks for it while the reviewer is deciding whether to start at all. It is
 * `buildActionPreview` either way, so there is still one place the words come
 * from.
 */
api.get("/actions/:actionId/preview", (req, res) => {
  res.json(buildActionPreview(req.params.actionId, { ...req.query }));
});

api.get("/sessions/:id/actions/:actionId/preview", (req, res) => {
  // The reading version: long values stay as their placeholder and travel in
  // `values`, so the dashboard can show them on hover instead of inline.
  res.json(buildActionPreview(req.params.actionId, { ...req.query, sessionId: req.params.id }));
});

api.post("/sessions/:id/actions/:actionId", (req, res) => {
  getSession(req.params.id);
  if (busy(req.params.id, res)) return;
  // `prompt` is the reviewer's edit of what the button was going to send.
  const { prompt, ...params } = req.body ?? {};
  inBackground(req.params.id, runAction(req.params.id, req.params.actionId, params, prompt));
  res.status(202).json({ started: true });
});

/* ------------------------------------------------------------- PRs */

api.get(
  "/session-prs/:id/threads",
  wrap(async (req, res) => {
    const pr = getSessionPr(req.params.id);
    res.json(await getThreads(prRef(pr), req.query.cache === "1"));
  }),
);

api.get(
  "/session-prs/:id/diff",
  wrap(async (req, res) => {
    const pr = getSessionPr(req.params.id);
    if (!pr.repoPath || !pr.sourceBranch || !pr.targetBranch) {
      res.status(404).json({ error: "This PR has not been prepared yet." });
      return;
    }
    const diff = await fileDiff({
      repoPath: pr.repoPath,
      baseBranch: pr.targetBranch,
      sourceBranch: pr.sourceBranch,
      file: req.query.file ? String(req.query.file) : undefined,
    });
    res.type("text/plain").send(diff);
  }),
);

api.post(
  "/session-prs/:id/threads/:threadId/reply",
  wrap(async (req, res) => {
    const pr = getSessionPr(req.params.id);
    const result = await replyToThread(prRef(pr), Number(req.params.threadId), req.body.content);
    emit(pr.sessionId, "thread.replied", {
      prId: pr.prId,
      threadId: Number(req.params.threadId),
      content: req.body.content,
    });
    res.json(result);
  }),
);

/* -------------------------------------------------------- findings */

api.get("/findings/:id", (req, res) => res.json(getFinding(req.params.id)));

api.post("/findings/:id/status", (req, res) => {
  res.json(setFindingStatus(req.params.id, req.body.status));
});

/* ----------------------------------------------------- permissions */

api.post("/permissions/:requestId", (req, res) => {
  const handled = decide(req.params.requestId, Boolean(req.body.allow), req.body.message);
  res.json({ handled });
});

/* ------------------------------------------------------- worktrees */

/* ----------------------------------------------------------- errors */

// Unknown API path: JSON, never the HTML 404 page, so the client can parse it.
api.use((_req, res) => {
  res.status(404).json({ error: "No such endpoint." });
});

// Express forwards synchronous throws here; `wrap` forwards rejected promises.
api.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  const message = error?.message ?? "Unexpected error.";
  const status = /^Unknown (session|finding|session PR|review profile)/.test(message) ? 404 : 400;
  console.error(`[api] ${req.method} ${req.originalUrl} -> ${status}: ${message}`);
  if (status !== 404 && error?.stack) console.error(error.stack);
  if (!res.headersSent) res.status(status).json({ error: message });
});
