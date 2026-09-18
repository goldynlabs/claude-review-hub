import { nanoid } from "nanoid";
import { emit } from "./events.js";
import { getSettings } from "./config.js";

interface Pending {
  resolve: (decision: { allow: boolean; message?: string }) => void;
  sessionId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

const pending = new Map<string, Pending>();

/** Tools a review can always use: reading the worktree and searching it. */
export const ALWAYS_ALLOWED = ["Read", "Glob", "Grep", "NotebookRead", "TodoWrite", "Task", "WebFetch", "WebSearch"];
const alwaysAllowed = new Set(ALWAYS_ALLOWED);

/** Editing files is one tool class that always asks. */
const alwaysConfirmed = [/^(Edit|Write|NotebookEdit|MultiEdit)$/];
export const ALWAYS_CONFIRMED_SOURCE = alwaysConfirmed.map((pattern) => pattern.source);

// Kept in the inspection response for API compatibility. Shell commands are
// never auto-classified: shell grammar cannot be secured with prefix regexes.
export const READ_ONLY_SOURCE: string[] = [];

export function needsConfirmation(toolName: string, input?: unknown): boolean {
  if (alwaysAllowed.has(toolName)) return false;
  // Reporting to the dashboard changes nothing outside it.
  if (toolName.startsWith("mcp__dashboard__")) return false;
  if (toolName === "Bash" || toolName === "PowerShell") {
    // Shell syntax is too expressive to classify safely with a command
    // blacklist (redirects, substitutions and newlines can all hide writes).
    // In ask mode, make the complete command visible to the user instead.
    return true;
  }
  return alwaysConfirmed.some((pattern) => pattern.test(toolName));
}

/**
 * Bridges the SDK's canUseTool callback to the dashboard: a tool call Claude
 * makes from the chat box surfaces as an Approve / Deny card in the session feed.
 */
export function askUser(
  sessionId: string,
  toolName: string,
  input: unknown,
  timeoutMs = 10 * 60_000,
): Promise<{ allow: boolean; message?: string }> {
  if (getSettings().permissionMode === "auto") return Promise.resolve({ allow: true });

  const id = nanoid(10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ allow: false, message: "Timed out waiting for approval in the dashboard." });
    }, timeoutMs);

    pending.set(id, {
      sessionId,
      toolName,
      input,
      createdAt: Date.now(),
      resolve: (decision) => {
        clearTimeout(timer);
        resolve(decision);
      },
    });
    emit(sessionId, "permission.requested", { requestId: id, toolName, input });
  });
}

export function decide(requestId: string, allow: boolean, message?: string): boolean {
  const request = pending.get(requestId);
  if (!request) return false;
  pending.delete(requestId);
  emit(request.sessionId, "permission.decided", { requestId, allow, toolName: request.toolName });
  request.resolve({ allow, message });
  return true;
}

/** Stopping a turn answers every card it left open, rather than leaving them. */
export function denyPending(sessionId: string, message: string): void {
  for (const [id, request] of pending) {
    if (request.sessionId === sessionId) decide(id, false, message);
  }
}

export function listPending(sessionId: string) {
  return [...pending.entries()]
    .filter(([, request]) => request.sessionId === sessionId)
    .map(([id, request]) => ({
      requestId: id,
      toolName: request.toolName,
      input: request.input,
      createdAt: request.createdAt,
    }));
}
