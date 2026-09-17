import { nanoid } from "nanoid";
import { db, now } from "../db.js";
import { emit } from "../events.js";
import type { FindingInput } from "./schema.js";

export interface StoredFinding {
  id: string;
  sessionId: string;
  sessionPrId: string;
  runId: string | null;
  /** A newer review of the same PR has replaced it; kept, but out of the way. */
  superseded?: boolean;
  file: string;
  line: number | null;
  endLine: number | null;
  dimension: string;
  severity: string;
  title: string;
  detail: string;
  suggestedFix: string | null;
  confidence: number;
  status: string;
  threadId: number | null;
  createdAt: string;
  updatedAt: string;
  evidence: Array<Record<string, unknown>>;
  verdicts: Array<{ by: string; confidence: number; reason: string; at: string }>;
}

export function createFinding(
  sessionId: string,
  sessionPrId: string,
  input: FindingInput,
  runId?: string,
): StoredFinding {
  const id = nanoid(12);
  const ts = now();
  db.prepare(
    `INSERT INTO findings (id, session_id, session_pr_id, run_id, file, line, end_line, dimension, severity,
       title, detail, suggested_fix, confidence, status, created_at, updated_at)
     VALUES (@id, @sessionId, @sessionPrId, @runId, @file, @line, @endLine, @dimension, @severity,
       @title, @detail, @suggestedFix, @confidence, 'open', @ts, @ts)`,
  ).run({
    id,
    sessionId,
    sessionPrId,
    runId: runId ?? null,
    file: input.file,
    line: input.line ?? null,
    endLine: input.endLine ?? null,
    dimension: input.dimension,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    suggestedFix: input.suggestedFix ?? null,
    confidence: input.confidence,
    ts,
  });

  const insertEvidence = db.prepare(
    `INSERT INTO evidence (id, finding_id, kind, file, line_start, line_end, snippet, source, quote, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of input.evidence) {
    insertEvidence.run(
      nanoid(12),
      id,
      item.kind,
      item.file ?? null,
      item.lineStart ?? null,
      item.lineEnd ?? null,
      item.snippet ?? null,
      item.source ?? null,
      item.quote ?? null,
      item.note ?? null,
    );
  }

  addVerdict(id, "initial", input.confidence, "Initial assessment from the review pass.");

  const finding = getFinding(id);
  emit(sessionId, "finding.created", finding);
  return finding;
}

/** Confidence history is append-only so a challenge never erases the first read. */
export function addVerdict(
  findingId: string,
  by: "initial" | "challenge" | "rescan" | "user",
  confidence: number,
  reason: string,
  raw?: unknown,
): void {
  db.prepare(
    "INSERT INTO verdicts (id, finding_id, by, confidence, reason, raw, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(nanoid(12), findingId, by, confidence, reason, raw ? JSON.stringify(raw) : null, now());
  db.prepare("UPDATE findings SET confidence = ?, updated_at = ? WHERE id = ?").run(
    confidence,
    now(),
    findingId,
  );
}

export function getFinding(id: string): StoredFinding {
  const row = db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as any;
  if (!row) throw new Error(`Unknown finding: ${id}`);
  const evidence = db.prepare("SELECT * FROM evidence WHERE finding_id = ?").all(id) as any[];
  const verdicts = db
    .prepare("SELECT by, confidence, reason, at FROM verdicts WHERE finding_id = ? ORDER BY at ASC")
    .all(id) as any[];
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionPrId: row.session_pr_id,
    runId: row.run_id ?? null,
    file: row.file,
    line: row.line,
    endLine: row.end_line,
    dimension: row.dimension,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    suggestedFix: row.suggested_fix,
    confidence: row.confidence,
    status: row.status,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: evidence.map(({ finding_id, ...rest }) => rest),
    verdicts,
  };
}

export function listFindings(sessionId: string, sessionPrId?: string): StoredFinding[] {
  const rows = sessionPrId
    ? (db.prepare("SELECT id FROM findings WHERE session_pr_id = ? ORDER BY created_at ASC").all(sessionPrId) as any[])
    : (db.prepare("SELECT id FROM findings WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as any[]);
  const findings = rows.map((row) => getFinding(row.id));

  // Re-reviewing a PR appends rather than deletes, so the reviewer keeps the
  // verdicts and decisions of earlier passes. The latest run is what is shown.
  const latestRun = new Map<string, string>();
  for (const finding of findings) {
    if (finding.runId) latestRun.set(finding.sessionPrId, finding.runId);
  }
  return findings.map((finding) => ({
    ...finding,
    superseded: Boolean(
      finding.runId && latestRun.get(finding.sessionPrId) && latestRun.get(finding.sessionPrId) !== finding.runId,
    ),
  }));
}

export function setFindingStatus(
  id: string,
  status: "open" | "resolved" | "dismissed" | "posted",
  threadId?: number,
): StoredFinding {
  db.prepare("UPDATE findings SET status = ?, thread_id = COALESCE(?, thread_id), updated_at = ? WHERE id = ?").run(
    status,
    threadId ?? null,
    now(),
    id,
  );
  const finding = getFinding(id);
  emit(finding.sessionId, "finding.updated", finding);
  return finding;
}

/** What gets posted to the PR as an inline comment. */
export function renderFindingComment(finding: StoredFinding): string {
  const icon = finding.severity === "critical" ? "🔴" : finding.severity === "warning" ? "🟡" : "🔵";
  const lines = [`${icon} **${finding.title}**`, "", finding.detail];
  if (finding.suggestedFix) lines.push("", "**Suggested fix**", "```", finding.suggestedFix, "```");
  lines.push("", `_${finding.dimension} · confidence ${(finding.confidence * 100).toFixed(0)}%_`);
  return lines.join("\n");
}
