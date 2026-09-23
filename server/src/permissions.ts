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
  for (const [id, request] of questions) {
    if (request.sessionId === sessionId) skipQuestions(id);
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

/* ------------------------------------------------------- questions */

/**
 * The agent asking *us* something, rather than asking to do something. Claude
 * Code renders `AskUserQuestion` as a picker; through the SDK the tool call
 * arrives here instead, and the answer travels back as `answers` written into
 * the tool's own input, keyed by the question, which is what the CLI turns
 * into the tool result. So it is not a permission: nothing is being approved,
 * and `auto` has no say in it - auto is the agent's licence to act, never a
 * licence to answer in the reviewer's name.
 */
export const QUESTION_TOOL = "AskUserQuestion";

export interface AskedQuestion {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description: string; preview?: string }>;
}

interface PendingQuestion {
  resolve: (answers: Record<string, string> | null) => void;
  sessionId: string;
  questions: AskedQuestion[];
  createdAt: number;
}

const questions = new Map<string, PendingQuestion>();

/** The questions of one tool call, as the dashboard has to draw them. */
export function questionsIn(input: unknown): AskedQuestion[] {
  const asked = (input as { questions?: unknown })?.questions;
  if (!Array.isArray(asked)) return [];
  return asked
    .filter((item): item is AskedQuestion => Boolean(item) && typeof (item as AskedQuestion).question === "string")
    .map((item) => ({
      question: String(item.question),
      header: String(item.header ?? ""),
      multiSelect: Boolean(item.multiSelect),
      options: Array.isArray(item.options)
        ? item.options.map((option) => ({
            label: String(option?.label ?? ""),
            description: String(option?.description ?? ""),
            ...(option?.preview ? { preview: String(option.preview) } : {}),
          }))
        : [],
    }));
}

export function askQuestions(
  sessionId: string,
  input: unknown,
  timeoutMs = 10 * 60_000,
): Promise<Record<string, string> | null> {
  const asked = questionsIn(input);
  // Nothing to draw is nothing to answer: let the turn carry on rather than
  // parking it behind a card with no questions in it.
  if (!asked.length) return Promise.resolve(null);

  const id = nanoid(10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      questions.delete(id);
      emit(sessionId, "question.answered", { requestId: id, answered: false });
      resolve(null);
    }, timeoutMs);

    questions.set(id, {
      sessionId,
      questions: asked,
      createdAt: Date.now(),
      resolve: (answers) => {
        clearTimeout(timer);
        resolve(answers);
      },
    });
    emit(sessionId, "question.asked", { requestId: id, questions: asked });
  });
}

/**
 * What the reviewer picked, by question. A value is the option's own label, or
 * whatever they typed instead: the tool offers no "other", and an answer the
 * options did not foresee is worth more than the nearest one that is wrong.
 */
export function answerQuestions(requestId: string, answers: Record<string, string>): boolean {
  const request = questions.get(requestId);
  if (!request) return false;
  const given = Object.fromEntries(
    request.questions
      .map((asked) => [asked.question, String(answers?.[asked.question] ?? "").trim()])
      .filter(([, value]) => value),
  );
  if (!Object.keys(given).length) return false;
  questions.delete(requestId);
  emit(request.sessionId, "question.answered", { requestId, answered: true, answers: given });
  request.resolve(given);
  return true;
}

/** Answering nothing is an answer too: the agent is told, and carries on. */
export function skipQuestions(requestId: string): boolean {
  const request = questions.get(requestId);
  if (!request) return false;
  questions.delete(requestId);
  emit(request.sessionId, "question.answered", { requestId, answered: false });
  request.resolve(null);
  return true;
}

export function listPendingQuestions(sessionId: string) {
  return [...questions.entries()]
    .filter(([, request]) => request.sessionId === sessionId)
    .map(([id, request]) => ({ requestId: id, questions: request.questions, createdAt: request.createdAt }));
}
