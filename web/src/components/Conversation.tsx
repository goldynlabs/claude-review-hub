import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsDown,
  Copy,
  CornerDownLeft,
  FolderTree,
  Loader2,
  ShieldQuestion,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { MODEL_OPTIONS, modelLabel } from "../lib/models";
import { useStore } from "../lib/store";
import type { ReviewEvent } from "../lib/types";
import { Button } from "./ui/Button";
import { Markdown } from "./ui/Markdown";
import { Select, SelectItem } from "./ui/Select";
import { Textarea } from "./ui/Textarea";
import { Tooltip } from "./ui/Tooltip";

/**
 * The whole session is one event stream. Anything the UI recognises is drawn as
 * a card; anything it does not is still shown, so the tool never hides what the
 * agent did just because there is no component for it yet.
 */
export function Conversation() {
  const { events, permissions, sessionId, session, prs, activePrId, projectRoot, streaming, preparing } = useStore();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const visible = useMemo(
    () => events.filter((event) => !["session.created", "session.updated", "finding.updated"].includes(event.type)),
    [events],
  );

  useEffect(() => {
    if (pinned) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, pinned]);

  const send = async () => {
    if (!message.trim() || !sessionId) return;
    setSending(true);
    try {
      await api.chat(sessionId, { message: message.trim(), sessionPrId: activePrId ?? undefined });
      setMessage("");
    } finally {
      setSending(false);
    }
  };

  const idle = !message.trim();
  const focused = prs.find((pr) => pr.id === activePrId);
  const worktree = focused?.worktreePath ?? projectRoot;
  // The focused PR's own thread is the one a terminal should resume into.
  const resumeId = focused?.claudeSessionId ?? session?.lastClaudeSessionId ?? session?.claudeSessionId;
  const resumeLabel = focused?.claudeSessionId ? `PR ${focused.prId}` : session?.lastClaudeLabel;

  return (
    <div className="flex h-full flex-col">
      <SessionHeader claudeSessionId={resumeId} label={resumeLabel} worktree={worktree} />

      <div
        className="flex-1 space-y-2 overflow-y-auto p-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
        }}
      >
        {visible.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}

        {/* What the agent is writing right now, replaced by the stored block
            as soon as it completes. */}
        {streaming && (
          <div className="flex">
            <div className="min-w-0 max-w-[92%] overflow-hidden break-words rounded-lg border bg-card px-3 py-2 text-sm">
              {streaming.label && (
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {streaming.label}
                </div>
              )}
              <Markdown>{streaming.text}</Markdown>
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-status-pulse bg-primary align-middle" />
            </div>
          </div>
        )}

        {Object.entries(preparing).map(([prId, step]) => (
          <div key={prId} className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Loader2 size={11} className="animate-spin" />
            PR {prId}: {stepLabel[step] ?? step}
          </div>
        ))}

        {permissions.map((request) => (
          <div key={request.requestId} className="card p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium">
              <ShieldQuestion size={13} className="text-primary" />
              Claude wants to run <span className="font-mono">{request.toolName}</span>
            </div>
            <pre className="mb-2 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
              {JSON.stringify(request.input, null, 2)}
            </pre>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => api.decide(request.requestId, true)}>
                <Check size={12} /> Approve
              </Button>
              <Button variant="destructive" onClick={() => api.decide(request.requestId, false)}>
                <X size={12} /> Deny
              </Button>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {!pinned && (
        <Button className="mx-3 mb-1 self-center" onClick={() => setPinned(true)}>
          <ChevronsDown size={12} /> Jump to latest
        </Button>
      )}

      <div className="border-t p-3">
        <Textarea
          rows={3}
          value={message}
          placeholder="Ask anything, or tell Claude what to do: reply to thread 12, approve the PR, re-check the auth changes."
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <ModelPicker />
          {/* One slot: Stop while the agent works, Send otherwise. A message
              typed mid-turn joins the turn already running rather than waiting,
              and after a Stop there is nothing to press - you type what comes
              next, and it is sent exactly as written. */}
          {idle && sessionId && session?.status === "running" ? (
            <span className="flex items-center gap-2">
              {/* Beside the one button that can end it, rather than across the
                  screen from it. */}
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Agent is working
              </span>
              <Button variant="destructive" onClick={() => api.stop(sessionId)}>
                <Square size={12} /> Stop
              </Button>
            </span>
          ) : (
            <Tooltip content="Ctrl + Enter to send">
              <Button variant="primary" onClick={send} disabled={sending || idle}>
                <CornerDownLeft size={12} /> Send
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The model this session talks to. Empty means "whatever settings say", so a
 * session that was never pinned keeps following the global choice.
 */
function ModelPicker() {
  const { sessionId, session, settings } = useStore();
  if (!sessionId) return null;
  const fallback = settings?.models.chat ?? "";
  const value = session?.model ?? "";
  const known = !value || MODEL_OPTIONS.some((option) => option.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => void api.updateSession(sessionId, { model: next || null })}
      className="w-auto min-w-[8.5rem] hover:bg-muted"
    >
      <SelectItem value="">Default · {modelLabel(fallback)}</SelectItem>
      {MODEL_OPTIONS.map((option) => (
        <SelectItem key={option.id} value={option.id}>
          {option.label} · {option.hint}
        </SelectItem>
      ))}
      {!known && <SelectItem value={value}>{value}</SelectItem>}
    </Select>
  );
}

const stepLabel: Record<string, string> = {
  resolving: "reading the pull request",
  worktree: "preparing a worktree",
  diff: "building the diff",
  threads: "loading existing comments",
};

/**
 * Where the agent is working and how to join it from a terminal. Both values are
 * long, so each is truncated to one line with the whole thing in the tooltip.
 */
function SessionHeader({
  claudeSessionId,
  label,
  worktree,
}: {
  claudeSessionId?: string | null;
  label?: string | null;
  worktree: string;
}) {
  if (!worktree && !claudeSessionId) return null;
  return (
    <div className="space-y-1 border-b px-3 py-2">
      {claudeSessionId && (
        <CopyRow
          icon={Terminal}
          label="Resume"
          text={`claude --resume ${claudeSessionId}`}
          hint={`Resume this Claude session in a terminal${label ? ` (${label})` : ""}. Run it from the worktree below.`}
        />
      )}
      {worktree && (
        <CopyRow icon={FolderTree} label="Worktree" text={worktree} hint="Worktree the agent reads and runs in." />
      )}
    </div>
  );
}

/** One truncated, copyable line: the shared tooltip carries the full value. */
function CopyRow({
  icon: Icon,
  label,
  text,
  hint,
}: {
  icon: typeof Terminal;
  label: string;
  text: string;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);
  const node = useRef<HTMLElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (http origin, denied permission): select it instead.
      const selection = window.getSelection();
      if (selection && node.current) {
        const range = document.createRange();
        range.selectNodeContents(node.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <Tooltip
        wide
        className="min-w-0 flex-1"
        content={
          <span className="block space-y-1">
            <span className="block break-all font-mono">{text}</span>
            <span className="block opacity-70">{hint}</span>
          </span>
        }
      >
        <code ref={node} className="block truncate font-mono text-[11px]">
          {text}
        </code>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto shrink-0"
        title="Copy"
        onClick={copy}
      >
        {copied ? <Check size={12} className="text-severity-suggestion" /> : <Copy size={12} />}
      </Button>
    </div>
  );
}

function EventRow({ event }: { event: ReviewEvent }) {
  const time = new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  switch (event.type) {
    case "chat.user":
      return (
        <Bubble align="right" time={time}>
          <Markdown>{event.payload.text}</Markdown>
        </Bubble>
      );
    case "assistant.text":
      return (
        <Bubble time={time} label={event.payload.label}>
          <Markdown>{event.payload.text}</Markdown>
        </Bubble>
      );
    case "tool.used":
      return (
        <Tooltip
          wide
          className="block w-full"
          content={
            <span className="block space-y-1">
              <span className="block font-mono">{event.payload.name}</span>
              <span className="block max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono opacity-80">
                {JSON.stringify(event.payload.input, null, 2)}
              </span>
            </span>
          }
        >
          <div className="flex w-full items-baseline gap-2 px-1 text-[11px] text-muted-foreground">
            <span className="shrink-0 whitespace-nowrap tabular-nums opacity-60">{time}</span>
            <Terminal size={11} className="shrink-0 translate-y-0.5" />
            <span className="shrink-0 whitespace-nowrap font-mono">{event.payload.name}</span>
            <span className="truncate opacity-70">{summarise(event.payload.input)}</span>
          </div>
        </Tooltip>
      );
    case "review.started":
      return <Note time={time}>Review started on PR {event.payload.prId} with profile {event.payload.profile}.</Note>;
    case "review.fanout":
      return <Note time={time}>Split into {event.payload.groups} parallel reviewers over {event.payload.files} files.</Note>;
    case "review.finished":
      return (
        <Note time={time}>
          PR {event.payload.prId} reviewed: {event.payload.total} findings, {event.payload.critical} critical.
        </Note>
      );
    case "finding.created":
      return (
        <Note time={time}>
          Finding: <span className="font-medium">{event.payload.title}</span>{" "}
          <span className="font-mono text-[11px]">{event.payload.file}</span>
        </Note>
      );
    case "finding.challenging":
      return <Note time={time}>Re-checking a finding{event.payload.userArgument ? " against your argument" : ""}.</Note>;
    case "pr.resolving":
      return <Note time={time}>Resolving PR {event.payload.prId}…</Note>;
    case "pr.error":
      return (
        <div className="break-words rounded-lg bg-destructive p-2 text-xs text-destructive-foreground">
          PR {event.payload.prId}: {event.payload.message}
        </div>
      );
    case "pr.attached":
      return (
        <Note time={time}>
          PR {event.payload.prId} attached ({event.payload.repo}) {event.payload.error ? `- ${event.payload.error}` : ""}
        </Note>
      );
    case "thread.replied":
      return <Note time={time}>Replied to thread {event.payload.threadId}.</Note>;
    case "thread.posted":
      return <Note time={time}>Posted a comment on PR {event.payload.prId}.</Note>;
    case "thread.status":
      return <Note time={time}>Thread {event.payload.threadId} set to {event.payload.status}.</Note>;
    case "pr.voted":
      return <Note time={time}>Voted {event.payload.vote} on PR {event.payload.prId}.</Note>;
    case "pr.created":
      return <Note time={time}>Created PR {event.payload.prId}: {event.payload.title}</Note>;
    case "run.error":
    case "review.error":
      return (
        <div className="break-words rounded-lg bg-destructive p-2 text-xs text-destructive-foreground">
          {event.payload.message}
        </div>
      );
    case "run.started":
    case "run.finished":
    case "permission.requested":
    case "permission.decided":
      return null;
    default:
      // Unknown event: still rendered, never swallowed.
      return (
        <details className="px-1 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-mono">{event.type}</summary>
          <pre className="mt-1 overflow-auto rounded bg-muted p-2">{JSON.stringify(event.payload, null, 2)}</pre>
        </details>
      );
  }
}

function Bubble({
  children,
  align = "left",
  time,
  label,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  time: string;
  label?: string;
}) {
  return (
    <div className={cn("flex", align === "right" && "justify-end")}>
      <div
        className={cn(
          "min-w-0 max-w-[92%] overflow-hidden break-words rounded-lg px-3 py-2 text-sm",
          align === "right" ? "bg-primary text-primary-foreground" : "border bg-card",
        )}
      >
        {label && <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>}
        {children}
        <div
          className={cn(
            "mt-1 whitespace-nowrap text-[10px]",
            align === "right" ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {time}
        </div>
      </div>
    </div>
  );
}

function Note({ children, time }: { children: React.ReactNode; time: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1 text-xs text-muted-foreground">
      <span className="shrink-0 whitespace-nowrap tabular-nums opacity-60">{time}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function summarise(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const values = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}=${String(value).slice(0, 40)}`)
    .slice(0, 2);
  return values.join(" ");
}
