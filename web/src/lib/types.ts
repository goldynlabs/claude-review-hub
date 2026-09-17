export type Severity = "critical" | "warning" | "suggestion";

export type ProviderKind = "azure" | "github";

export interface Account {
  id: string;
  displayName: string;
  email: string;
}

/** Which host this repo belongs to, and where that was worked out from. */
export interface RepoContext {
  /** Empty when nothing identified the host yet. */
  provider: ProviderKind | "";
  org: string;
  project: string;
  repo?: string;
  source?: "git-remote" | "cli-defaults" | "none";
  remoteUrl?: string;
}

/**
 * One host, as this machine can see it right now. Both are always listed, so
 * the sidebar can be honest about a machine that has one CLI and about one
 * that has both.
 */
export interface Connection {
  provider: ProviderKind;
  label: string;
  cli: string;
  signInHint: string;
  orgLabel: string;
  /** Empty when the host has no such level, as GitHub has none. */
  projectLabel: string;
  threadStates: Array<{ value: string; label: string }>;
  /** Which of those states mean "dealt with", for the open/resolved filter. */
  resolvedStates: string[];
  installed: boolean;
  signedIn: boolean;
  user: Account | null;
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  /** True while the name is still derived from the PRs in the session. */
  titleAuto: boolean;
  status: string;
  profileId: string | null;
  extraContext: string | null;
  claudeSessionId: string | null;
  /** Latest Claude session from any run (review, challenge or chat). */
  lastClaudeSessionId: string | null;
  lastClaudeLabel: string | null;
  /** Chat model pinned for this session; null uses the one from settings. */
  model: string | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChangedFile {
  file: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface SessionPr {
  id: string;
  sessionId: string;
  prId: number;
  /** Which host it lives on: it decides the link, the CLI and the thread states. */
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
  worktreePath: string | null;
  /** The Claude thread that reviewed this PR; challenge and chat continue it. */
  claudeSessionId: string | null;
  state: "pending" | "ready" | "reviewing" | "reviewed" | "error";
  error: string | null;
  /** Where it lives on the web, built by the server so only one place knows
   *  how each host spells a pull request URL. */
  webUrl: string;
  files: ChangedFile[];
}

export interface Evidence {
  id: string;
  kind: "code" | "rule" | "trace" | "context";
  file?: string | null;
  line_start?: number | null;
  line_end?: number | null;
  snippet?: string | null;
  source?: string | null;
  quote?: string | null;
  note?: string | null;
}

export interface Verdict {
  by: "initial" | "challenge" | "rescan" | "user";
  confidence: number;
  reason: string;
  at: string;
}

export interface Finding {
  id: string;
  sessionId: string;
  sessionPrId: string;
  /** The agent turn that reported it. */
  runId: string | null;
  /** A newer review of the same PR has replaced it; kept, but out of the way. */
  superseded?: boolean;
  file: string;
  line: number | null;
  endLine: number | null;
  dimension: string;
  severity: Severity;
  title: string;
  detail: string;
  suggestedFix: string | null;
  confidence: number;
  status: "open" | "resolved" | "dismissed" | "posted";
  threadId: number | null;
  evidence: Evidence[];
  verdicts: Verdict[];
}

export interface Comment {
  id: number;
  author: string;
  content: string;
  publishedDate: string;
}

export interface Thread {
  id: number;
  status: string;
  filePath: string | null;
  line: number | null;
  /** False when this host cannot change this thread's state. GitHub only. */
  canSetStatus?: boolean;
  /** The lines it was written against have since changed. GitHub only. */
  outdated?: boolean;
  comments: Comment[];
}

export interface ReviewEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  payload: any;
  ts: string;
  /** Live-only event: shown as it happens, never part of the stored log. */
  transient?: boolean;
}

export interface Dimension {
  id: string;
  label: string;
  enabled: boolean;
  prompt: string;
}

export interface Profile {
  id: string;
  name: string;
  dimensions: Dimension[];
  context: string;
  include: string[];
  exclude: string[];
  useProjectRules: boolean;
  severityFloor: Severity;
  confidenceFloor: number;
}

export interface Settings {
  /** What the agent writes for the dashboard. Prompts stay English. */
  sessionLanguage: string;
  /** What the agent writes into the pull request, on whichever host. */
  pullRequestLanguage: string;
  models: { review: string; challenge: string; chat: string };
  repos: Record<string, string>;
  allowCodeEdits: boolean;
  permissionMode: "ask" | "auto";
  worktreeTtlHours: number;
  showCost: boolean;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: unknown;
}

/** A button prompt template, served so the tooltip and the request match. */
export interface ActionTemplate {
  id: string;
  label: string;
  template: string;
  computed?: boolean;
  /** Changes something on the host, so the dashboard confirms it first. */
  writes?: boolean;
  category?: string;
  where?: string;
  /** True when Settings > Prompts replaced the built-in wording. */
  overridden?: boolean;
  /** The built-in wording, for putting it back. */
  defaultTemplate?: string;
}
