import { query, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { db, now } from "./db.js";
import { emit, publish } from "./events.js";
import { getSettings } from "./config.js";
import { projectRoot } from "./paths.js";
import { askUser, denyPending, needsConfirmation } from "./permissions.js";
import { dashboardMcpServer } from "./mcp.js";
import { getSession, setLastClaudeSession, updateSession } from "./sessions.js";
import { ClaudeCodeMissing, findClaudeCode } from "./claudeCode.js";
import { ready } from "./boot.js";

export interface RunResult {
  claudeSessionId: string | null;
  costUsd: number;
  text: string;
  isError: boolean;
}

/**
 * Git verbs that rewrite a working tree. Harmless in a review worktree, and
 * unrecoverable in the developer's own checkout.
 */
const DESTRUCTIVE_GIT = /\bgit\b[^\n]*\b(checkout|switch|reset|clean|stash|pull|merge|rebase|cherry-pick|restore)\b/;

/**
 * The agent drives everything through the shell, so this is the one thing it is
 * never allowed to do: rewrite the repository the developer is working in.
 * Worktrees under .review-tool are its own and stay fair game.
 */
const WORKTREE_MARKER = "/.review-tool/temp/worktrees/";

function inWorktree(path: string | undefined): boolean {
  return Boolean(path && path.replace(/\\/g, "/").toLowerCase().includes(WORKTREE_MARKER));
}

export function blocksWorkingTree(command: string): boolean {
  if (!DESTRUCTIVE_GIT.test(command)) return false;

  const target = /-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "");
  if (target) return !inWorktree(target);

  // `cd <worktree> && git reset` is the same thing as `git -C <worktree> reset`,
  // and refusing it only teaches the agent to phrase it differently.
  const cd = /(?:^|&&|\|\||;)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "");
  if (cd) return !inWorktree(cd);

  // Neither: it runs in the session cwd, which is the developer's own checkout.
  return true;
}

// One live Claude session per dashboard session, so turns cannot interleave.
const queues = new Map<string, Promise<unknown>>();

/**
 * The CLI reads its prompts from a stream that stays open for the whole turn.
 * Two things depend on that: `interrupt()` is only deliverable while stdin is
 * open, and a message typed mid-turn can be folded into the turn already
 * running instead of waiting for a new process.
 */
class InputStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private closed = false;

  constructor(first: string) {
    this.push(first);
  }

  push(text: string): void {
    this.queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.wake();
  }

  /** False once the turn's input is closed: nothing more can be folded in. */
  get open(): boolean {
    return !this.closed;
  }

  /** Ends the turn's input, which is what lets the CLI exit. */
  close(): void {
    this.closed = true;
    this.wake();
  }

  async *messages(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length) yield this.queue.shift()!;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.waiting = resolve));
    }
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.();
  }
}

interface LiveRun {
  input: InputStream;
  abort: AbortController;
  /** Set by stopSession, so nothing the CLI says on its way out reaches the UI. */
  stopped: boolean;
  interrupt?: () => Promise<unknown>;
  /** The turn's own result, awaited by anything folded into it. */
  done: Promise<RunResult>;
  settle: (result: RunResult) => void;
}

/** Turns in flight, so the dashboard can stop one. */
const inFlight = new Map<string, LiveRun>();

/** How long an interrupt is given before the process is killed outright. */
const INTERRUPT_GRACE_MS = 4_000;

export function isRunning(sessionId: string): boolean {
  return inFlight.has(sessionId);
}

/**
 * Stops the turn, not the session. The Claude session survives, so Resume picks
 * up with everything it had already read still in context.
 */
export function stopSession(sessionId: string): boolean {
  const run = inFlight.get(sessionId);
  if (!run) return false;
  run.stopped = true;
  // The dashboard must not look busy while the CLI winds down. The run's own
  // end sets the same status when it lands.
  updateSession(sessionId, { status: "stopped" });
  denyPending(sessionId, "Stopped in the dashboard.");

  // Interrupt reaches the CLI straight away and lets it close the turn itself.
  // Abort is the fallback, for a CLI too old to answer one or one that hangs.
  const interrupted = run.interrupt?.() ?? Promise.reject(new Error("no interrupt"));
  void interrupted.catch(() => run.abort.abort());
  const kill = setTimeout(() => {
    if (inFlight.get(sessionId) === run) run.abort.abort();
  }, INTERRUPT_GRACE_MS);
  void run.done.finally(() => clearTimeout(kill));
  return true;
}

export interface SessionRunOptions {
  sessionId: string;
  prompt: string;
  label?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
}

/**
 * Sends a turn to the session's Claude session, creating it on the first call
 * and resuming it afterwards. Every step of a review - resolving the PR,
 * building the worktree, reading the diff, judging it, posting comments - is a
 * turn of this one session, which is what makes `claude --resume` show the lot.
 */
export function runSessionAgent(options: SessionRunOptions): Promise<RunResult> {
  // Something typed while the agent works joins the turn already running: the
  // input stream is still open, so it arrives without a second process and with
  // everything the agent has read still in front of it. Actions keep their own
  // prompts, model and system prompt, so those still queue.
  const live = inFlight.get(options.sessionId);
  if (live && !live.stopped && live.input.open && options.label === "chat") {
    live.input.push(options.prompt);
    return live.done;
  }

  const previous = queues.get(options.sessionId) ?? Promise.resolve();
  const next = previous.then(
    () => execute(options),
    () => execute(options),
  );
  queues.set(options.sessionId, next.catch(() => undefined));
  return next;
}

async function execute(options: SessionRunOptions): Promise<RunResult> {
  // The port opens before the skills are installed, so a turn started in that
  // first second waits for them rather than running without one.
  await ready;

  const settings = getSettings();
  const session = getSession(options.sessionId);
  const auto = settings.permissionMode === "auto";
  const runId = nanoid(10);
  const context = { sessionId: options.sessionId, runId };
  const abortController = new AbortController();
  const input = new InputStream(options.prompt);
  let settle: (result: RunResult) => void = () => undefined;
  const run: LiveRun = {
    input,
    abort: abortController,
    stopped: false,
    done: new Promise<RunResult>((resolve) => (settle = resolve)),
    settle: (result) => settle(result),
  };
  inFlight.set(options.sessionId, run);

  // Driven by the Claude Code on this machine, so the SDK never needs the copy
  // it would otherwise download. Missing is a clear error rather than a
  // confusing one from inside the SDK.
  const executable = findClaudeCode();
  if (!executable) throw new ClaudeCodeMissing();

  const sdkOptions: Options = {
    // The repository itself, so the agent inherits its CLAUDE.md, rules and
    // skills, and so one Claude session can span every PR in the review.
    cwd: projectRoot,
    pathToClaudeCodeExecutable: executable,
    model: options.model ?? settings.models.chat,
    resume: session.claudeSessionId ?? undefined,
    maxTurns: options.maxTurns ?? 120,
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: options.systemPrompt },
    // Only the dashboard's own tools. Azure is the agent's job, through the az
    // CLI the skill documents, exactly as it works outside this tool.
    mcpServers: { dashboard: dashboardMcpServer(context) },
    includePartialMessages: true,
    disallowedTools: settings.allowCodeEdits ? [] : ["Edit", "Write", "MultiEdit", "NotebookEdit"],
    permissionMode: "default",
    abortController,
    // Installed even in auto mode: auto decides approvals, it does not license
    // the agent to rewrite the developer's checkout.
    canUseTool: async (toolName, input) => {
      // Bash is not the only shell: the agent reaches for PowerShell on Windows,
      // and a guard that only knows about Bash guards nothing.
      const command =
        typeof (input as { command?: unknown })?.command === "string" ? (input as { command: string }).command : "";
      if (command && blocksWorkingTree(command)) {
        emit(options.sessionId, "tool.blocked", { name: toolName, command });
        return {
          behavior: "deny",
          message:
            "Refused: that rewrites the developer's working tree. Work in a worktree under .review-tool/temp/worktrees/ instead.",
        };
      }
      if (auto || !needsConfirmation(toolName, input)) return { behavior: "allow", updatedInput: input };
      const decision = await askUser(options.sessionId, toolName, input);
      return decision.allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: decision.message ?? "Denied in the dashboard." };
    },
  };

  let claudeSessionId: string | null = null;
  let costUsd = 0;
  let text = "";
  let isError = false;
  let stopped = false;

  emit(options.sessionId, "run.started", { label: options.label, model: sdkOptions.model, runId });
  updateSession(options.sessionId, { status: "running" });

  const conversation = query({ prompt: input.messages(), options: sdkOptions });
  run.interrupt = () => conversation.interrupt();

  try {
    for await (const message of conversation) {
      handleMessage(message as SDKMessage);
      // The turn is over: closing its input is what lets the CLI exit, and an
      // open stream would otherwise hold this loop for ever.
      if (message.type === "result") input.close();
    }
  } catch (error) {
    // Stopping is a decision, not a failure, and it must not read as one.
    if (run.stopped || abortController.signal.aborted) {
      stopped = true;
    } else {
      isError = true;
      emit(options.sessionId, "run.error", { label: options.label, message: (error as Error).message });
    }
  } finally {
    input.close();
    inFlight.delete(options.sessionId);
  }
  if (run.stopped) stopped = true;

  if (costUsd > 0) {
    db.prepare("UPDATE sessions SET cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?").run(
      costUsd,
      now(),
      options.sessionId,
    );
  }
  updateSession(options.sessionId, { status: stopped ? "stopped" : isError ? "error" : "done" });
  emit(options.sessionId, "run.finished", { label: options.label, costUsd, isError, stopped });

  const result = { claudeSessionId, costUsd, text, isError };
  run.settle(result);
  return result;

  /** Writes the id through to the session row, and to the dashboard, at once. */
  function rememberSession(id: string): void {
    if (!id || id === claudeSessionId) return;
    claudeSessionId = id;
    setLastClaudeSession(options.sessionId, id, options.label);
    if (id !== session.claudeSessionId) updateSession(options.sessionId, { claudeSessionId: id });
  }

  function handleMessage(message: SDKMessage): void {
    // A stopped turn goes quiet at once: whatever the CLI is still writing on
    // its way out is not wanted on screen. The result is kept for its cost.
    if (run.stopped && message.type !== "result") return;
    switch (message.type) {
      case "system":
        // Saved the moment it is known, not when the turn ends: a review runs
        // for minutes, and `claude --resume` is most useful while it is running.
        if (message.subtype === "init") rememberSession(message.session_id);
        break;
      case "stream_event": {
        const event = message.event as any;
        if (event.type === "content_block_delta") {
          const delta = event.delta ?? {};
          if (delta.type === "text_delta" && delta.text) {
            publish(options.sessionId, "assistant.delta", { label: options.label, text: delta.text });
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            publish(options.sessionId, "thinking.delta", { label: options.label, text: delta.thinking });
          }
        } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          publish(options.sessionId, "tool.started", { label: options.label, name: event.content_block.name });
        }
        break;
      }
      case "assistant": {
        for (const block of message.message.content) {
          if (block.type === "text") {
            text += block.text;
            emit(options.sessionId, "assistant.text", { label: options.label, text: block.text });
          } else if (block.type === "tool_use") {
            emit(options.sessionId, "tool.used", { label: options.label, name: block.name, input: block.input });
          }
        }
        break;
      }
      case "result": {
        costUsd += message.total_cost_usd ?? 0;
        if (message.session_id) rememberSession(message.session_id);
        // An interrupted turn reports a failure subtype; being stopped is not one.
        if (message.subtype !== "success" && !run.stopped) isError = true;
        break;
      }
      default:
        break;
    }
  }
}
