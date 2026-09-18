import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db, now } from "./db.js";
import { sessionDir } from "./paths.js";

export interface ReviewEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  payload: unknown;
  ts: string;
  /** Live-only: delivered to open dashboards, never written to the log. */
  transient?: boolean;
}

type Listener = (event: ReviewEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const seqCache = new Map<string, number>();

const insert = db.prepare(
  "INSERT INTO events (id, session_id, seq, type, payload, ts) VALUES (?, ?, ?, ?, ?, ?)",
);

function nextSeq(sessionId: string): number {
  if (!seqCache.has(sessionId)) {
    const row = db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session_id = ?")
      .get(sessionId) as { seq: number };
    seqCache.set(sessionId, row.seq);
  }
  const next = (seqCache.get(sessionId) ?? 0) + 1;
  seqCache.set(sessionId, next);
  return next;
}

/**
 * The append-only log is the single source of truth for a session.
 * The UI renders what it recognises and falls back to a raw bubble for the rest,
 * which is what keeps the tool as flexible as a chatbot while still visualising.
 */
export function emit(sessionId: string, type: string, payload: unknown = {}): ReviewEvent {
  const event: ReviewEvent = {
    id: nanoid(12),
    sessionId,
    seq: nextSeq(sessionId),
    type,
    payload,
    ts: now(),
  };
  const serialized = JSON.stringify(payload);
  insert.run(event.id, sessionId, event.seq, type, serialized, event.ts);
  fs.appendFileSync(path.join(sessionDir(sessionId), "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
  for (const listener of listeners.get(sessionId) ?? []) listener(event);
  for (const listener of listeners.get("*") ?? []) listener(event);
  return event;
}

/**
 * Token deltas and progress ticks arrive by the hundreds. They are worth seeing
 * live but not worth a row each, so they reach subscribers without being stored;
 * the completed message is what gets persisted.
 */
export function publish(sessionId: string, type: string, payload: unknown = {}): void {
  const event: ReviewEvent = {
    id: nanoid(12),
    sessionId,
    seq: 0,
    type,
    payload,
    ts: now(),
    transient: true,
  };
  for (const listener of listeners.get(sessionId) ?? []) listener(event);
  for (const listener of listeners.get("*") ?? []) listener(event);
}

export function subscribe(sessionId: string, listener: Listener): () => void {
  if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
  listeners.get(sessionId)!.add(listener);
  return () => {
    const group = listeners.get(sessionId);
    group?.delete(listener);
    if (group?.size === 0) listeners.delete(sessionId);
  };
}

export function listEvents(sessionId: string, afterSeq = 0): ReviewEvent[] {
  const rows = db
    .prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC")
    .all(sessionId, afterSeq) as Array<{
      id: string; session_id: string; seq: number; type: string; payload: string; ts: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    type: row.type,
    payload: JSON.parse(row.payload),
    ts: row.ts,
  }));
}
