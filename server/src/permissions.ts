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

/** Editing files is the one tool class that always asks; the pull request now
 *  goes through the shell, where the read-only list below decides. */
const alwaysConfirmed = [/^(Edit|Write|NotebookEdit|MultiEdit)$/];
export const ALWAYS_CONFIRMED_SOURCE = alwaysConfirmed.map((pattern) => pattern.source);

/**
 * Shell commands a review cannot avoid. The agent drives git and the host's own
 * CLI itself, so confirming each one would mean dozens of clicks per pull
 * request; everything listed here reads, and none of it changes the repository
 * or the pull request.
 */
const READ_ONLY_COMMANDS = [
  /^git\s+(-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(fetch|diff|log|show|status|branch|remote|rev-parse|ls-files|ls-tree|cat-file|blame|merge-base|worktree\s+(?:add|list|prune))\b/,
  /^az\s+(account|repos|devops)\s+[^|&;]*\b(show|list|get-access-token|configure)\b/,
  // `gh api` is a read only while it stays a GET: a field or an explicit method
  // turns the same command into a POST, so those fall through to a confirmation.
  /^gh\s+(auth\s+(status|token)|pr\s+(view|list|diff|status|checks)|repo\s+view|search\s+|api(?!\s[^|&;]*(?:-X|--method|-f\s|-F\s|--field|--raw-field|--input))\s)/,
  /^(ls|dir|cat|type|head|tail|wc|findstr|rg|grep|pwd|echo|cd|pushd)\b/,
];

export const READ_ONLY_SOURCE = READ_ONLY_COMMANDS.map((pattern) => pattern.source);

function isReadOnlyShell(command: string): boolean {
  // One write in a chain must not be waved through by a safe first step.
  const steps = command
    .split(/&&|\|\||;|\|/)
    .map((step) => step.trim())
    .filter(Boolean);
  return steps.length > 0 && steps.every((step) => READ_ONLY_COMMANDS.some((pattern) => pattern.test(step)));
}

export function needsConfirmation(toolName: string, input?: unknown): boolean {
  if (alwaysAllowed.has(toolName)) return false;
  // Reporting to the dashboard changes nothing outside it.
  if (toolName.startsWith("mcp__dashboard__")) return false;
  if (toolName === "Bash" || toolName === "PowerShell") {
    const command =
      typeof (input as { command?: unknown })?.command === "string" ? (input as { command: string }).command : "";
    return !isReadOnlyShell(command);
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
