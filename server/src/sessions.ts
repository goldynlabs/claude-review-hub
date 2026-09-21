import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, now } from "./db.js";
import { emit, publish } from "./events.js";
import { registerRepo, rememberContext } from "./config.js";
import { invalidateRepoCache } from "./repos.js";
import { providerFor, type ProviderKind, type PullRequestRef } from "./providers/index.js";
import { sessionsDir } from "./paths.js";
import { removeWorktree } from "./git/worktree.js";
import { listProfiles } from "./review/profiles.js";

export interface Session {
  id: string;
  title: string;
  /** True while the name is still derived from the PRs in the session. */
  titleAuto: boolean;
  status: string;
  profileId: string | null;
  extraContext: string | null;
  claudeSessionId: string | null;
  /** Latest Claude session from any run, and what that run was. */
  lastClaudeSessionId: string | null;
  lastClaudeLabel: string | null;
  /** Chat model chosen for this session; null uses the one from settings. */
  model: string | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPr {
  id: string;
  sessionId: string;
  prId: number;
  /** Which host this pull request lives on: it decides every word about it. */
  provider: ProviderKind;
  org: string;
  project: string;
  repo: string;
  repoPath: string | null;
  title: string | null;
  author: string | null;
  prStatus: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  headSha: string | null;
  baseSha: string | null;
  worktreePath: string | null;
  /** The Claude session that reviewed this PR; challenge and chat continue it. */
  claudeSessionId: string | null;
  /**
   * Set by Auto detect only: the profile this one pull request is reviewed
   * against, and what the reviewer asked for it alone. `null` on the profile
   * is a deliberate answer - review it against the note and nothing else.
   */
  profileId: string | null;
  reviewNote: string | null;
  state: string;
  error: string | null;
  /** Where this pull request lives on the web. Built here so the dashboard
   *  never has to know how each host spells a pull request URL. */
  webUrl: string;
  files: Array<{ file: string; status: string; additions: number; deletions: number }>;
}

function mapSession(row: any): Session {
  return {
    id: row.id,
    title: row.title,
    titleAuto: Boolean(row.title_auto),
    status: row.status,
    profileId: row.profile_id,
    extraContext: row.extra_context,
    claudeSessionId: row.claude_session_id,
    lastClaudeSessionId: row.last_claude_session_id,
    lastClaudeLabel: row.last_claude_label,
    model: row.model ?? null,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPr(row: any): SessionPr {
  const provider = (row.provider ?? "azure") as ProviderKind;
  return {
    id: row.id,
    sessionId: row.session_id,
    prId: row.pr_id,
    provider,
    org: row.org,
    project: row.project,
    repo: row.repo,
    repoPath: row.repo_path,
    title: row.title,
    author: row.author,
    prStatus: row.pr_status,
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    worktreePath: row.worktree_path,
    claudeSessionId: row.claude_session_id,
    profileId: row.profile_id ?? null,
    reviewNote: row.review_note ?? null,
    state: row.state,
    error: row.error,
    webUrl: providerFor(provider).prUrl({
      provider,
      org: row.org,
      project: row.project,
      repo: row.repo,
      prId: row.pr_id,
    }),
    files: row.files_json ? JSON.parse(row.files_json) : [],
  };
}

/** Placeholder until the first PR is attached, which renames the session. */
function draftTitle(): string {
  return `Review ${new Date().toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function createSession(input: { title?: string; profileId?: string; extraContext?: string }): Session {
  const id = nanoid(10);
  const ts = now();
  const named = Boolean(input.title?.trim());
  db.prepare(
    `INSERT INTO sessions (id, title, title_auto, status, profile_id, extra_context, cost_usd, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.title?.trim() || draftTitle(),
    named ? 0 : 1,
    // "default" is a profile like any other now, so it may have been deleted.
    input.profileId ?? listProfiles()[0]?.id ?? "default",
    input.extraContext ?? "",
    ts,
    ts,
  );
  const session = getSession(id);
  emit(id, "session.created", session);
  return session;
}

export function getSession(id: string): Session {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!row) throw new Error(`Unknown session: ${id}`);
  return mapSession(row);
}

export function listSessions(): Session[] {
  return (db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as any[]).map(mapSession);
}

export function updateSession(
  id: string,
  patch: Partial<Pick<Session, "title" | "titleAuto" | "status" | "profileId" | "extraContext" | "claudeSessionId" | "model">>,
): Session {
  const current = getSession(id);
  // Renaming by hand stops the generated name from overwriting it later.
  const titleAuto = patch.titleAuto ?? (patch.title !== undefined ? false : current.titleAuto);
  db.prepare(
    `UPDATE sessions SET title = ?, title_auto = ?, status = ?, profile_id = ?, extra_context = ?, claude_session_id = ?, model = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title ?? current.title,
    titleAuto ? 1 : 0,
    patch.status ?? current.status,
    patch.profileId ?? current.profileId,
    patch.extraContext ?? current.extraContext,
    patch.claudeSessionId ?? current.claudeSessionId,
    patch.model !== undefined ? patch.model : current.model,
    now(),
    id,
  );
  const session = getSession(id);
  emit(id, "session.updated", session);
  return session;
}

/**
 * Findings, evidence, verdicts, PRs and events go with the session through the
 * foreign keys. Its worktrees go too, except any a second session is also
 * holding: those stay until the TTL prune reaches them.
 */
export async function deleteSession(id: string): Promise<void> {
  getSession(id);
  // Listed before the row goes, since the PRs cascade with it.
  const worktrees = worktreesOnlyThisSessionHas(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  // The database deletion is authoritative. A filesystem permission problem
  // must not turn an already-completed deletion into an apparent failure.
  try {
    fs.rmSync(path.join(sessionsDir, id), { recursive: true, force: true });
  } catch {
    // Old session artifacts are safe to leave for manual cleanup.
  }

  // `git worktree remove` on a large checkout takes long enough that waiting
  // for it would leave the deleted session sitting in the list. The record is
  // already gone; the directories are housekeeping and can finish after.
  void (async () => {
    for (const worktree of worktrees) {
      await removeWorktree(worktree.repoPath, worktree.path).catch(() => undefined);
    }
  })();
}

/**
 * A worktree is named after the pull request, not the session, so two sessions
 * reviewing the same one share the directory. Deleting a session takes only
 * those no other session is still holding; the rest age out on the TTL.
 */
function worktreesOnlyThisSessionHas(id: string): { repoPath: string; path: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT repo_path AS repoPath, worktree_path AS path FROM session_prs
        WHERE session_id = ? AND worktree_path IS NOT NULL AND repo_path IS NOT NULL
          AND worktree_path NOT IN (
            SELECT worktree_path FROM session_prs
             WHERE session_id != ? AND worktree_path IS NOT NULL)`,
    )
    .all(id, id) as { repoPath: string; path: string }[];
}

/**
 * Every run reports the Claude session it used, so the dashboard can offer
 * `claude --resume` for a review, not only for a chat.
 */
/** The first run on a PR owns its thread; later runs resume it. */
export function setPrClaudeSession(sessionPrId: string, claudeSessionId: string): void {
  db.prepare("UPDATE session_prs SET claude_session_id = ? WHERE id = ? AND claude_session_id IS NULL").run(
    claudeSessionId,
    sessionPrId,
  );
}

export function setLastClaudeSession(sessionId: string, claudeSessionId: string, label?: string): void {
  const current = db
    .prepare("SELECT last_claude_session_id, last_claude_label FROM sessions WHERE id = ?")
    .get(sessionId) as { last_claude_session_id: string | null; last_claude_label: string | null } | undefined;
  // The id stops changing after the first turn, so comparing it alone would
  // freeze the label on whatever ran first.
  if (!current) return;
  if (current.last_claude_session_id === claudeSessionId && current.last_claude_label === (label ?? null)) return;

  db.prepare("UPDATE sessions SET last_claude_session_id = ?, last_claude_label = ?, updated_at = ? WHERE id = ?").run(
    claudeSessionId,
    label ?? null,
    now(),
    sessionId,
  );
  emit(sessionId, "session.updated", getSession(sessionId));
}

/**
 * No agent turn survives a restart, so a session still marked as running is a
 * lie. Left alone it would keep every action button disabled for good, since
 * that is the flag the dashboard reads to know a turn is in flight.
 */
export function resetRunningSessions(): number {
  return db.prepare("UPDATE sessions SET status = 'stopped' WHERE status = 'running'").run().changes;
}

export function listSessionPrs(sessionId: string): SessionPr[] {
  return (db.prepare("SELECT * FROM session_prs WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as any[]).map(mapPr);
}

export function getSessionPr(id: string): SessionPr {
  const row = db.prepare("SELECT * FROM session_prs WHERE id = ?").get(id);
  if (!row) throw new Error(`Unknown session PR: ${id}`);
  return mapPr(row);
}

export function prRef(pr: SessionPr): PullRequestRef {
  return { provider: pr.provider, org: pr.org, project: pr.project, repo: pr.repo, prId: pr.prId };
}

/**
 * Names the session after the PRs it holds, so nothing has to be typed when it
 * is created. Stops as soon as the user renames it by hand.
 */
export function refreshAutoTitle(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session.titleAuto) return;
  const prs = listSessionPrs(sessionId);
  if (!prs.length) return;

  // The PR title is what the session is actually about, so it is the name.
  const first = truncate(prs[0].title ?? `PR ${prs[0].prId}`, 60);
  const title = prs.length === 1 ? first : `${first} +${prs.length - 1}`;
  if (title !== session.title) updateSession(sessionId, { title, titleAuto: true });
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

export interface RegisterPrInput {
  prId: number;
  provider: ProviderKind;
  org: string;
  project: string;
  repo: string;
  repoPath: string;
  worktreePath: string;
  sourceBranch: string;
  targetBranch: string;
  title?: string;
  author?: string;
  prStatus?: string;
  headSha?: string;
  baseSha?: string;
  files?: Array<{ file: string; status: string; additions: number; deletions: number }>;
}

/**
 * The agent resolved a PR and built its worktree; this is it telling the
 * dashboard, which is what draws the tab, the file list and the diff panel.
 */
export function registerPr(sessionId: string, input: RegisterPrInput): SessionPr {
  const existing = db
    .prepare("SELECT id FROM session_prs WHERE session_id = ? AND pr_id = ? AND repo = ?")
    .get(sessionId, input.prId, input.repo) as { id: string } | undefined;
  const id = existing?.id ?? nanoid(10);

  db.prepare(
    `INSERT INTO session_prs (id, session_id, pr_id, provider, org, project, repo, repo_path, title, author, pr_status,
        source_branch, target_branch, head_sha, base_sha, worktree_path, files_json, state, error, created_at)
     VALUES (@id, @sessionId, @prId, @provider, @org, @project, @repo, @repoPath, @title, @author, @prStatus,
        @sourceBranch, @targetBranch, @headSha, @baseSha, @worktreePath, @filesJson, 'ready', NULL, @createdAt)
     ON CONFLICT(session_id, pr_id, repo) DO UPDATE SET
        provider = excluded.provider,
        repo_path = excluded.repo_path, title = excluded.title, author = excluded.author,
        pr_status = excluded.pr_status, source_branch = excluded.source_branch,
        target_branch = excluded.target_branch, head_sha = excluded.head_sha,
        base_sha = excluded.base_sha, worktree_path = excluded.worktree_path,
        files_json = COALESCE(excluded.files_json, session_prs.files_json),
        -- A re-review refreshes the worktree mid-turn; that is still the turn
        -- reviewing this pull request, not a pull request going back to ready.
        state = CASE WHEN session_prs.state = 'reviewing' THEN 'reviewing' ELSE 'ready' END,
        error = NULL`,
  ).run({
    id,
    sessionId,
    prId: input.prId,
    provider: input.provider,
    org: input.org,
    project: input.project,
    repo: input.repo,
    repoPath: input.repoPath,
    title: input.title ?? null,
    author: input.author ?? null,
    prStatus: input.prStatus ?? null,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    headSha: input.headSha ?? null,
    baseSha: input.baseSha ?? null,
    worktreePath: input.worktreePath,
    filesJson: input.files ? JSON.stringify(input.files) : null,
    createdAt: now(),
  });

  registerRepo(input.repo, input.repoPath);
  invalidateRepoCache();
  rememberContext({ provider: input.provider, org: input.org, project: input.project });

  const pr = getSessionPr(id);
  emit(sessionId, "pr.attached", pr);
  refreshAutoTitle(sessionId);
  return pr;
}

/**
 * What Auto detect settled on, once the reviewer has seen it and had their say.
 * A null profile is an answer, not a blank: that pull request is reviewed
 * against the note alone, which is why one of the two must be filled in.
 */
export function setPrProfile(sessionPrId: string, profileId: string | null, note: string): SessionPr {
  db.prepare("UPDATE session_prs SET profile_id = ?, review_note = ? WHERE id = ?").run(
    profileId,
    note.trim() || null,
    sessionPrId,
  );
  const pr = getSessionPr(sessionPrId);
  emit(pr.sessionId, "pr.attached", pr);
  return pr;
}

/**
 * Where a pull request is in the review: `reviewing` while a turn is about it,
 * `reviewed` once one has been, which is what turns Review into Re-review.
 */
export function setPrState(sessionPrId: string, state: "ready" | "reviewing" | "reviewed"): SessionPr {
  db.prepare("UPDATE session_prs SET state = ? WHERE id = ?").run(state, sessionPrId);
  const pr = getSessionPr(sessionPrId);
  emit(pr.sessionId, "pr.attached", pr);
  return pr;
}

/** Resolves a PR of this session by its number, for the tools that act on one. */
export function findSessionPr(sessionId: string, prId?: number): SessionPr | null {
  const prs = listSessionPrs(sessionId);
  if (prId) {
    const matches = prs.filter((pr) => pr.prId === prId);
    return matches.length === 1 ? matches[0] : null;
  }
  return prs.length === 1 ? prs[0] : (prs.at(-1) ?? null);
}

