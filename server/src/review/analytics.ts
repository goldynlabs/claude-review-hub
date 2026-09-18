import { db } from "../db.js";
import { getThreads, prKey, providerFor } from "../providers/index.js";
import { listSessionPrs, prRef, type SessionPr } from "../sessions.js";

/**
 * What the dashboard has already recorded, counted. Nothing here asks a CLI:
 * every number comes out of the database, so the panel opens at once. The one
 * thing the database cannot answer is what the comment threads on a pull
 * request look like right now, and that is `threadStats` below.
 */

export interface AnalyticsTotals {
  sessions: number;
  prs: number;
  prsReviewed: number;
  findings: number;
  /** Findings from an earlier review of the same PR, kept but not counted above. */
  superseded: number;
  posted: number;
  open: number;
  resolved: number;
  dismissed: number;
  costUsd: number;
  avgFindingsPerPr: number;
  avgConfidence: number;
  postRate: number;
}

export interface Bucket {
  key: string;
  total: number;
  posted: number;
}

export interface AnalyticsPr {
  id: string;
  sessionId: string;
  sessionTitle: string;
  prId: number;
  provider: string;
  repo: string;
  title: string | null;
  author: string | null;
  prStatus: string | null;
  state: string;
  webUrl: string;
  createdAt: string;
  findings: number;
  posted: number;
  open: number;
  resolved: number;
  dismissed: number;
  critical: number;
}

export interface Analytics {
  totals: AnalyticsTotals;
  bySeverity: Bucket[];
  byDimension: Bucket[];
  byStatus: Bucket[];
  byProvider: Array<{ key: string; prs: number; findings: number }>;
  byPrStatus: Array<{ key: string; count: number }>;
  byPrState: Array<{ key: string; count: number }>;
  byConfidence: Bucket[];
  /** One entry per day for the last 30 days, oldest first. */
  activity: Array<{ date: string; prs: number; findings: number }>;
  prs: AnalyticsPr[];
}

interface FindingRow {
  session_id: string;
  session_pr_id: string;
  run_id: string | null;
  dimension: string;
  severity: string;
  status: string;
  confidence: number;
  thread_id: number | null;
  created_at: string;
}

/** The order the severities are written in, so a chart never reshuffles them. */
const SEVERITY_ORDER = ["critical", "warning", "suggestion"];
const STATUS_ORDER = ["open", "posted", "resolved", "dismissed"];
const CONFIDENCE_BANDS = [
  { key: "≥ 90%", min: 0.9 },
  { key: "70 – 89%", min: 0.7 },
  { key: "50 – 69%", min: 0.5 },
  { key: "< 50%", min: 0 },
];

/** Counts into an ordered list of buckets; `posted` is "reached the PR". */
function tally(rows: FindingRow[], keyOf: (row: FindingRow) => string, order?: string[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const key of order ?? []) map.set(key, { key, total: 0, posted: 0 });
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key) ?? { key, total: 0, posted: 0 };
    bucket.total += 1;
    if (row.thread_id !== null) bucket.posted += 1;
    map.set(key, bucket);
  }
  const buckets = [...map.values()];
  return order ? buckets : buckets.sort((a, b) => b.total - a.total);
}

/** Findings of the newest review of each PR; the earlier passes are kept aside. */
function partitionBySupersession(rows: FindingRow[]): { live: FindingRow[]; superseded: number } {
  const latestRun = new Map<string, string>();
  for (const row of rows) {
    if (row.run_id) latestRun.set(row.session_pr_id, row.run_id);
  }
  const live = rows.filter(
    (row) => !row.run_id || !latestRun.get(row.session_pr_id) || latestRun.get(row.session_pr_id) === row.run_id,
  );
  return { live, superseded: rows.length - live.length };
}

export function analytics(): Analytics {
  const findingRows = db
    .prepare(
      `SELECT session_id, session_pr_id, run_id, dimension, severity, status, confidence, thread_id, created_at
       FROM findings ORDER BY created_at ASC`,
    )
    .all() as FindingRow[];
  const { live, superseded } = partitionBySupersession(findingRows);

  const sessionRows = db
    .prepare("SELECT id, title, cost_usd FROM sessions")
    .all() as Array<{ id: string; title: string; cost_usd: number }>;
  const sessionTitle = new Map(sessionRows.map((row) => [row.id, row.title]));

  const prRows = db
    .prepare(
      `SELECT id, session_id, pr_id, provider, org, project, repo, title, author, pr_status, state, created_at
       FROM session_prs ORDER BY created_at ASC`,
    )
    .all() as Array<Record<string, any>>;

  const perPr = new Map<string, AnalyticsPr>();
  for (const row of prRows) {
    const provider = (row.provider ?? "azure") as string;
    perPr.set(row.id, {
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: sessionTitle.get(row.session_id) ?? "",
      prId: row.pr_id,
      provider,
      repo: row.repo,
      title: row.title,
      author: row.author,
      prStatus: row.pr_status,
      state: row.state,
      webUrl: providerFor(provider).prUrl({
        provider: provider as any,
        org: row.org,
        project: row.project,
        repo: row.repo,
        prId: row.pr_id,
      }),
      createdAt: row.created_at,
      findings: 0,
      posted: 0,
      open: 0,
      resolved: 0,
      dismissed: 0,
      critical: 0,
    });
  }

  for (const row of live) {
    const pr = perPr.get(row.session_pr_id);
    if (!pr) continue;
    pr.findings += 1;
    if (row.thread_id !== null) pr.posted += 1;
    if (row.severity === "critical") pr.critical += 1;
    if (row.status === "open") pr.open += 1;
    if (row.status === "resolved") pr.resolved += 1;
    if (row.status === "dismissed") pr.dismissed += 1;
  }

  const posted = live.filter((row) => row.thread_id !== null).length;
  const prsReviewed = prRows.filter((row) => row.state === "reviewed").length;
  const costUsd = sessionRows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);

  const totals: AnalyticsTotals = {
    sessions: sessionRows.length,
    prs: prRows.length,
    prsReviewed,
    findings: live.length,
    superseded,
    posted,
    open: live.filter((row) => row.status === "open").length,
    resolved: live.filter((row) => row.status === "resolved").length,
    dismissed: live.filter((row) => row.status === "dismissed").length,
    costUsd,
    avgFindingsPerPr: prRows.length ? live.length / prRows.length : 0,
    avgConfidence: live.length ? live.reduce((sum, row) => sum + row.confidence, 0) / live.length : 0,
    postRate: live.length ? posted / live.length : 0,
  };

  const byProviderMap = new Map<string, { key: string; prs: number; findings: number }>();
  for (const pr of perPr.values()) {
    const entry = byProviderMap.get(pr.provider) ?? { key: pr.provider, prs: 0, findings: 0 };
    entry.prs += 1;
    entry.findings += pr.findings;
    byProviderMap.set(pr.provider, entry);
  }

  const count = (values: Array<string | null>) => {
    const map = new Map<string, number>();
    for (const value of values) {
      const key = value ?? "unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([key, value]) => ({ key, count: value })).sort((a, b) => b.count - a.count);
  };

  // Thirty days of bars, including the empty ones: a gap is information too.
  const days: Array<{ date: string; prs: number; findings: number }> = [];
  const index = new Map<string, { date: string; prs: number; findings: number }>();
  const today = new Date();
  for (let back = 29; back >= 0; back -= 1) {
    const at = new Date(today);
    at.setDate(today.getDate() - back);
    const entry = { date: at.toISOString().slice(0, 10), prs: 0, findings: 0 };
    days.push(entry);
    index.set(entry.date, entry);
  }
  for (const row of prRows) {
    const day = index.get(String(row.created_at).slice(0, 10));
    if (day) day.prs += 1;
  }
  for (const row of live) {
    const day = index.get(row.created_at.slice(0, 10));
    if (day) day.findings += 1;
  }

  return {
    totals,
    bySeverity: tally(live, (row) => row.severity, SEVERITY_ORDER),
    byDimension: tally(live, (row) => row.dimension),
    byStatus: tally(live, (row) => row.status, STATUS_ORDER),
    byProvider: [...byProviderMap.values()],
    byPrStatus: count(prRows.map((row) => row.pr_status)),
    byPrState: count(prRows.map((row) => row.state)),
    byConfidence: tally(
      live,
      (row) => CONFIDENCE_BANDS.find((band) => row.confidence >= band.min)?.key ?? "< 50%",
      CONFIDENCE_BANDS.map((band) => band.key),
    ),
    activity: days,
    prs: [...perPr.values()].reverse(),
  };
}

export interface PrThreadStats {
  id: string;
  total: number;
  /** Threads in a state this host does not count as dealt with. */
  active: number;
  resolved: number;
  comments: number;
  /** Of those threads, the ones this tool opened by posting a finding. */
  ours: number;
  oursActive: number;
  /** When the counts were read from the host; null when never read. */
  fetchedAt: string | null;
  error?: string;
}

export interface ThreadStats {
  live: boolean;
  prs: PrThreadStats[];
}

function summarise(pr: SessionPr, threads: any[], fetchedAt: string | null): PrThreadStats {
  const resolvedStates = providerFor(pr.provider).resolvedStates;
  const ourThreadIds = new Set(
    (
      db.prepare("SELECT DISTINCT thread_id FROM findings WHERE session_pr_id = ? AND thread_id IS NOT NULL").all(
        pr.id,
      ) as Array<{ thread_id: number }>
    ).map((row) => row.thread_id),
  );
  let active = 0;
  let ours = 0;
  let oursActive = 0;
  let comments = 0;
  for (const thread of threads) {
    const isActive = !resolvedStates.includes(thread.status);
    if (isActive) active += 1;
    comments += thread.comments?.length ?? 0;
    if (ourThreadIds.has(thread.id)) {
      ours += 1;
      if (isActive) oursActive += 1;
    }
  }
  return {
    id: pr.id,
    total: threads.length,
    active,
    resolved: threads.length - active,
    comments,
    ours,
    oursActive,
    fetchedAt,
  };
}

/**
 * The comment threads of every pull request the tool has touched. Read from the
 * `pr_threads` cache it opens at once and may be stale; read live it costs one
 * `az` or `gh` call per pull request, which is why the panel shows the cached
 * numbers first and swaps these in when they arrive.
 */
export async function threadStats(live: boolean): Promise<ThreadStats> {
  const sessions = db.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>;
  const prs = sessions.flatMap((session) => listSessionPrs(session.id));

  if (!live) {
    return {
      live: false,
      prs: prs.map((pr) => {
        const row = db.prepare("SELECT json, fetched_at FROM pr_threads WHERE pr_key = ?").get(prKey(prRef(pr))) as
          | { json: string; fetched_at: string }
          | undefined;
        if (!row) return summarise(pr, [], null);
        return summarise(pr, JSON.parse(row.json), row.fetched_at);
      }),
    };
  }

  // A few at a time: enough to hide the latency, not enough to make a host
  // throttle a machine that has reviewed a hundred pull requests.
  const results: PrThreadStats[] = [];
  const queue = [...prs];
  const worker = async () => {
    for (let pr = queue.shift(); pr; pr = queue.shift()) {
      try {
        results.push(summarise(pr, await getThreads(prRef(pr), false), new Date().toISOString()));
      } catch (error) {
        results.push({ ...summarise(pr, [], null), error: (error as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { live: true, prs: results };
}
