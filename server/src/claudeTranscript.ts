import { getSessionInfo, getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { projectRoot } from "./paths.js";

export interface ClaudeTranscriptPart {
  /** Stable across reloads: the transcript message UUID plus its content index. */
  id: string;
  role: "user" | "assistant";
  kind: "text" | "tool";
  text?: string;
  name?: string;
  input?: unknown;
}

export interface ClaudeTranscript {
  sessionId: string;
  /** Claude Code only exposes the transcript's mtime, not one time per message. */
  lastModified: string | null;
  parts: ClaudeTranscriptPart[];
}

/**
 * Read the conversation Claude Code will actually resume. This deliberately
 * goes through the Agent SDK instead of depending on ~/.claude's private JSONL
 * layout, which has changed between Claude Code releases.
 */
export async function readClaudeTranscript(sessionId: string | null): Promise<ClaudeTranscript | null> {
  if (!sessionId) return null;

  const [messages, info] = await Promise.all([
    getSessionMessages(sessionId, { dir: projectRoot }),
    getSessionInfo(sessionId, { dir: projectRoot }),
  ]);

  // An empty, unknown id must not make the dashboard hide its own event log.
  if (!info && messages.length === 0) return null;
  return {
    sessionId,
    lastModified: info ? new Date(info.lastModified).toISOString() : null,
    parts: messages.flatMap(normaliseMessage),
  };
}

function normaliseMessage(message: SessionMessage): ClaudeTranscriptPart[] {
  if (message.type !== "user" && message.type !== "assistant") return [];
  const role = message.type;
  const envelope = message.message as { content?: unknown } | undefined;
  const content = envelope?.content;

  // User prompts commonly use the short string form. Tool results use an
  // array and are intentionally omitted: the matching assistant tool call is
  // useful in the transcript, while its often enormous raw result is not.
  if (typeof content === "string") {
    return content.trim()
      ? [{ id: `${message.uuid}:0`, role, kind: "text", text: content }]
      : [];
  }
  if (!Array.isArray(content)) return [];

  return content.flatMap((raw, index): ClaudeTranscriptPart[] => {
    if (!raw || typeof raw !== "object") return [];
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      return [{ id: `${message.uuid}:${index}`, role, kind: "text", text: block.text }];
    }
    if (message.type === "assistant" && block.type === "tool_use" && typeof block.name === "string") {
      return [{
        id: `${message.uuid}:${index}`,
        role: "assistant",
        kind: "tool",
        name: block.name,
        input: block.input,
      }];
    }
    return [];
  });
}
