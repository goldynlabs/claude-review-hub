import type { ClaudeTranscript, ClaudeTranscriptPart, ReviewEvent } from "./types";

/**
 * Add only conversation parts that Claude Code knows about and the dashboard
 * does not. The dashboard's conversation events form a subsequence of Claude's
 * transcript. Gaps are inserted before the next matching dashboard event, so
 * terminal turns retain their real order even if the dashboard was used again
 * before the browser refreshed.
 */
export function syncClaudeEvents(events: ReviewEvent[], transcript: ClaudeTranscript | null): ReviewEvent[] {
  if (!transcript) return events;
  const candidates = events.flatMap((event, index) => {
    const signature = eventSignature(event);
    return signature ? [{ index, signature }] : [];
  });
  const timestamp = transcript.lastModified ?? "";
  const before = new Map<number, ReviewEvent[]>();
  const trailing: ReviewEvent[] = [];
  let candidateAt = 0;
  let pending: ReviewEvent[] = [];

  for (const part of transcript.parts) {
    const signature = partSignature(part);
    const found = candidates.findIndex((candidate, index) => index >= candidateAt && candidate.signature === signature);
    if (found >= 0) {
      const eventIndex = candidates[found].index;
      if (pending.length) before.set(eventIndex, [...(before.get(eventIndex) ?? []), ...pending]);
      pending = [];
      candidateAt = found + 1;
    } else {
      pending.push(partEvent(part, transcript.sessionId, timestamp));
    }
  }
  trailing.push(...pending);

  return events.flatMap((event, index) => [...(before.get(index) ?? []), event]).concat(trailing);
}

function eventSignature(event: ReviewEvent): string | null {
  switch (event.type) {
    case "chat.user":
      return signature("user", "text", event.payload.text);
    case "action.started":
      return signature("user", "text", event.payload.prompt);
    case "assistant.text":
      return signature("assistant", "text", event.payload.text);
    case "tool.used":
      return signature("assistant", "tool", event.payload.name, event.payload.input);
    default:
      return null;
  }
}

function partSignature(part: ClaudeTranscriptPart): string {
  return part.kind === "text"
    ? signature(part.role, "text", part.text)
    : signature(part.role, "tool", part.name, part.input);
}

function signature(role: string, kind: string, value: unknown, input?: unknown): string {
  return `${role}:${kind}:${stableStringify(value)}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function partEvent(part: ClaudeTranscriptPart, sessionId: string, ts: string): ReviewEvent {
  if (part.kind === "tool") {
    return {
      id: `claude:${part.id}`,
      sessionId,
      seq: 0,
      type: "tool.used",
      payload: { name: part.name, input: part.input, external: true },
      ts,
    };
  }
  return {
    id: `claude:${part.id}`,
    sessionId,
    seq: 0,
    type: part.role === "user" ? "chat.user" : "assistant.text",
    payload: { text: part.text, external: true },
    ts,
  };
}
