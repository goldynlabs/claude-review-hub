import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle, RefreshCw, Send } from "lucide-react";
import { api } from "../lib/api";
import { useHost, type HostWords } from "../lib/providers";
import { useStore } from "../lib/store";
import { useAgentBusy } from "./AgentButton";
import { useConfirm } from "./Confirm";
import { cn } from "../lib/cn";
import type { SessionPr, Thread } from "../lib/types";
import { Button } from "./ui/Button";
import { Markdown } from "./ui/Markdown";
import { Select, SelectItem } from "./ui/Select";
import { CopyButton, CopyId } from "./ui/CopyId";
import { Empty } from "./ui/Empty";
import { StatusBadge } from "./ui/StatusBadge";

/**
 * The whole status vocabulary of the host this pull request is on, not just
 * resolve, and it goes through the agent. Azure DevOps has five states; GitHub
 * resolves a conversation or does not.
 */
function ThreadStatus({
  thread,
  prId,
  host,
  onDone,
}: {
  thread: Thread;
  prId: number;
  host: HostWords;
  onDone: () => void;
}) {
  const sessionId = useStore((state) => state.sessionId);
  const agentBusy = useAgentBusy();
  const confirm = useConfirm();

  // Picking from the list only proposes the change; it reaches the host once
  // the confirmation is accepted, so a stray click cannot resolve a thread.
  const propose = async (status: string) => {
    if (!sessionId || status === thread.status) return;
    const label = host.threadStates.find((item) => item.value === status)?.label ?? status;
    const { ok, note, prompt } = await confirm({
      title: `Set thread to ${label}`,
      writes: true,
      host: host.label,
      action: "thread.status",
      params: { threadId: thread.id, prId, status },
    });
    if (!ok) return;
    await api.runAction(sessionId, "thread.status", { threadId: thread.id, prId, status, note, prompt });
    onDone();
  };

  return (
    <span className="w-32">
      <Select value={thread.status} onValueChange={propose} disabled={agentBusy}>
        {host.threadStates.map((status) => (
          <SelectItem key={status.value} value={status.value}>
            {status.label}
          </SelectItem>
        ))}
      </Select>
    </span>
  );
}

/**
 * Whatever the host calls its states, what a reviewer actually wants is "still
 * needs me" against "already dealt with"; the host says which is which.
 */
const isResolved = (thread: Thread, host: HostWords) => host.resolvedStates.includes(thread.status);

const threadFileLocation = (thread: Thread) => `${thread.filePath}${thread.line ? `:${thread.line}` : ""}`;

/**
 * Written by hand rather than by locale, as the session list is, so a date is
 * never an ambiguous month/day order.
 */
function whenLabel(published: string | number | undefined): string {
  if (!published) return "";
  const at = new Date(published);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())} ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}

/** A thread is as recent as its last message, which is what sorting goes by. */
function lastActivity(thread: Thread): number {
  return thread.comments.reduce((latest, comment) => {
    const at = new Date(comment.publishedDate).getTime();
    return Number.isNaN(at) ? latest : Math.max(latest, at);
  }, 0);
}

/**
 * One fill per state, so two states never read as the same badge: active is the
 * contrast colour because it is the one still asking for something, pending is
 * amber for waiting, fixed and resolved are the green of work done, "will not
 * fix" is a decision against it, and closed is parked rather than settled.
 */
const THREAD_STATUS_TONES: Record<string, "on" | "off" | "critical" | "warning" | "success"> = {
  active: "on",
  pending: "warning",
  fixed: "success",
  resolved: "success",
  wontFix: "critical",
  closed: "off",
};

const threadStatusTone = (status: string) => THREAD_STATUS_TONES[status] ?? "on";

/**
 * Existing PR conversation is shown here from the start, but it only reaches
 * Claude when the user actually replies to a thread or asks about it.
 */
export function Threads({ pr, onCount }: { pr: SessionPr; onCount?: (count: number) => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"all" | "open" | "resolved">("all");
  // Every thread starts folded; the header line says whether it is worth opening.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const sessionId = useStore((state) => state.sessionId);
  const confirm = useConfirm();
  const host = useHost(pr.provider);
  const loadGeneration = useRef(0);

  const load = async (cache = true) => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const next = await api.threads(pr.id, cache);
      if (generation !== loadGeneration.current) return;
      setThreads(next);
      setCollapsed(new Set(next.map((thread) => thread.id)));
      onCount?.(next.length);
    } catch {
      // Keep the last successful list; a transient host failure must not erase it.
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    return () => { loadGeneration.current += 1; };
  }, [pr.id]);

  /**
   * Through the agent, like every other change to a thread: the prompt names
   * the thread and the pull request, so what is being answered is never a guess.
   */
  const reply = async (threadId: number) => {
    if (!sessionId) return;
    const params = { threadId, prId: pr.prId, repo: pr.repo };
    const { ok, note, prompt } = await confirm({
      title: "Reply to this thread",
      writes: true,
      host: host.label,
      action: "thread.reply",
      params,
      noteParam: "content",
      noteLabel: "Your reply",
      notePlaceholder: "Fixed in the follow-up commit, thanks.",
    });
    if (!ok) return;
    await api.runAction(sessionId, "thread.reply", { ...params, content: note.trim(), prompt });
    await load(false);
  };

  // Newest first: the conversation that moved last is the one being answered.
  const visible = threads
    .filter((thread) =>
      status === "all" ? true : status === "resolved" ? isResolved(thread, host) : !isResolved(thread, host),
    )
    .sort((a, b) => lastActivity(b) - lastActivity(a));
  const openCount = threads.filter((thread) => !isResolved(thread, host)).length;

  const toggle = (id: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {visible.length} of {threads.length} thread{threads.length === 1 ? "" : "s"}
        </div>
        <div className="ml-auto w-40">
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectItem value="all">All ({threads.length})</SelectItem>
            <SelectItem value="open">Open ({openCount})</SelectItem>
            <SelectItem value="resolved">Resolved ({threads.length - openCount})</SelectItem>
          </Select>
        </div>
        <Button onClick={() => load(false)} disabled={loading}>
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {visible.map((thread) => {
        const resolved = isResolved(thread, host);
        const open = !collapsed.has(thread.id);
        const first = thread.comments[0];
        return (
          <div key={thread.id} className={cn("group card", resolved && "opacity-60")}>
            <div className="flex items-start gap-2 p-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggle(thread.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(thread.id);
                  }
                }}
                className="flex min-w-0 flex-1 items-start gap-2 text-left text-xs text-muted-foreground"
              >
                {open ? (
                  <ChevronDown size={12} className="mt-0.5 shrink-0" />
                ) : (
                  <ChevronRight size={12} className="mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  {/* Who said it and when, before how much of it there is: the
                      three things a folded thread is scanned for. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyId id={thread.id} copyText={`Thread ${thread.id}`} />
                    {first && <span className="font-medium text-foreground">{first.author}</span>}
                    {whenLabel(lastActivity(thread)) && (
                      <span className="whitespace-nowrap text-foreground">at {whenLabel(lastActivity(thread))}</span>
                    )}
                    <span className="whitespace-nowrap">
                      {thread.comments.length} message{thread.comments.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {/* Its own row, labelled like the file and the description
                      below it, rather than trailing the first line. */}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Status:
                    </span>
                    <StatusBadge tone={threadStatusTone(thread.status)} className="capitalize">
                      {host.threadStates.find((state) => state.value === thread.status)?.label ?? thread.status}
                    </StatusBadge>
                    {/* GitHub marks a conversation whose lines have since
                        changed; it is why a thread can look out of place. */}
                    {thread.outdated && <StatusBadge tone="warning">outdated</StatusBadge>}
                  </div>

                  {/* Folded, the first line is what says whether it matters. */}
                  {!open && first && (
                    <div className="mt-1 flex min-w-0 items-baseline gap-1.5 truncate text-foreground/80">
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        Description:
                      </span>
                      <span className="truncate">{first.content.replace(/\s+/g, " ").slice(0, 120)}</span>
                    </div>
                  )}

                  <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
                    {thread.filePath ? (
                      <>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          File:
                        </span>
                        <span className="min-w-0 truncate font-mono">{threadFileLocation(thread)}</span>
                        <CopyButton text={threadFileLocation(thread)} />
                      </>
                    ) : (
                      <span>General</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {open && (
              <div className="px-3 pb-3">
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {thread.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md bg-muted p-2">
                      <div className="mb-1 flex items-baseline gap-1.5 text-xs">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Author:</span>
                        <span className="font-medium">{comment.author}</span>
                        <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground/70">
                          {whenLabel(comment.publishedDate)}
                        </span>
                      </div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        Description:
                      </div>
                      <Markdown className="text-sm">{comment.content}</Markdown>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Own row, pushed right and revealed on hover; acting on a thread
                never needs it opened, and the row keeps its height either way. */}
            <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3 invisible group-hover:visible group-focus-within:visible">
              <Button onClick={() => reply(thread.id)}>
                <Send size={12} /> Reply
              </Button>
              {/* A comment on the pull request itself has no state to set on
                  GitHub, so the control is left out rather than made to fail. */}
              {thread.canSetStatus !== false && (
                <ThreadStatus thread={thread} prId={pr.prId} host={host} onDone={() => load(false)} />
              )}
            </div>
          </div>
        );
      })}

      {!visible.length && !loading && threads.length > 0 && (
        <div className="card p-6 text-center text-sm text-muted-foreground">No {status} threads.</div>
      )}

      {!threads.length && !loading && (
        <Empty icon={MessageCircle} title="No comments on this PR yet." />
      )}

    </div>
  );
}
