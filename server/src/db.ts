import Database from "better-sqlite3";
import path from "node:path";
import { dataDir, ensureLayout } from "./paths.js";

ensureLayout();

export const db = new Database(path.join(dataDir, "review.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'idle',   -- idle | running | done | error
  title_auto        INTEGER NOT NULL DEFAULT 1,      -- 0 once the user renames it
  profile_id        TEXT,
  extra_context     TEXT,
  claude_session_id TEXT,                           -- for resume / chat continuation
  last_claude_session_id TEXT,                      -- latest run of any kind
  last_claude_label TEXT,                           -- which run that was
  cost_usd          REAL NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- One session can review many PRs, across repos.
CREATE TABLE IF NOT EXISTS session_prs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pr_id         INTEGER NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'azure',      -- azure | github
  org           TEXT NOT NULL,
  project       TEXT NOT NULL,
  repo          TEXT NOT NULL,
  repo_path     TEXT,
  title         TEXT,
  author        TEXT,
  pr_status     TEXT,
  source_branch TEXT,
  target_branch TEXT,
  head_sha      TEXT,
  base_sha      TEXT,
  worktree_path TEXT,
  claude_session_id TEXT,                             -- the thread that reviewed it
  state         TEXT NOT NULL DEFAULT 'pending',    -- pending | ready | reviewing | reviewed | error
  error         TEXT,
  files_json    TEXT,                               -- changed file list for the diff panel
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, pr_id, repo)
);

CREATE TABLE IF NOT EXISTS findings (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_pr_id TEXT NOT NULL REFERENCES session_prs(id) ON DELETE CASCADE,
  file          TEXT NOT NULL,
  line          INTEGER,
  end_line      INTEGER,
  dimension     TEXT NOT NULL,
  severity      TEXT NOT NULL,                      -- critical | warning | suggestion
  title         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  suggested_fix TEXT,
  confidence    REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',       -- open | resolved | dismissed | posted
  thread_id     INTEGER,                            -- set once posted to the PR
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id          TEXT PRIMARY KEY,
  finding_id  TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                        -- code | rule | trace | context
  file        TEXT,
  line_start  INTEGER,
  line_end    INTEGER,
  snippet     TEXT,
  source      TEXT,
  quote       TEXT,
  note        TEXT
);

-- Confidence is never overwritten: every challenge appends a verdict.
CREATE TABLE IF NOT EXISTS verdicts (
  id         TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  by         TEXT NOT NULL,                         -- initial | challenge | rescan | user
  confidence REAL NOT NULL,
  reason     TEXT NOT NULL,
  raw        TEXT,
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  ts         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_threads (
  pr_key     TEXT PRIMARY KEY,                      -- provider/org/project/repo/prId
  json       TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
CREATE INDEX IF NOT EXISTS idx_findings_pr      ON findings(session_pr_id);
CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_prs_session      ON session_prs(session_id);
`);

export function now(): string {
  return new Date().toISOString();
}

/** Adds a column to an existing database; new installs get it from the schema above. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// The session name is generated from the PRs until the user renames it by hand.
ensureColumn("sessions", "title_auto", "INTEGER NOT NULL DEFAULT 1");

// The most recent Claude session of any run, so a review can be picked up in a
// terminal too. Kept apart from claude_session_id, which is the chat thread.
ensureColumn("sessions", "last_claude_session_id", "TEXT");
// Continuity lives on the PR, not the dashboard session: a Claude session is
// bound to the cwd it started in, and that is the PR's worktree.
ensureColumn("session_prs", "claude_session_id", "TEXT");
// Which review run reported a finding, so a re-review supersedes rather than
// duplicates, without throwing away what the earlier run found.
ensureColumn("findings", "run_id", "TEXT");
ensureColumn("sessions", "last_claude_label", "TEXT");
// Per-session model override for chat; null falls back to the settings model.
ensureColumn("sessions", "model", "TEXT");
// Which host a PR lives on. Everything recorded before GitHub existed here was
// an Azure DevOps pull request, so that is what the default says.
ensureColumn("session_prs", "provider", "TEXT NOT NULL DEFAULT 'azure'");
