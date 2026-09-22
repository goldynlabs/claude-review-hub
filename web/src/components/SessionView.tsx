import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, ExternalLink, GitPullRequest, List, Loader2, Play, Plus, RefreshCw, SearchCheck, SlidersHorizontal, ThumbsUp } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useDragScroll } from "../lib/dragScroll";
import { useHost } from "../lib/providers";
import { useStore } from "../lib/store";
import { readUrl, writeUrl } from "../lib/url";
import { AgentButton } from "./AgentButton";
import { useConfirm } from "./Confirm";
import { DiffPanel } from "./DiffPanel";
import { FindingCard } from "./FindingCard";
import { GoldenPath } from "./GoldenPath";
import { Threads } from "./Threads";
import type { FindingStatus, Severity } from "../lib/types";
import { Button } from "./ui/Button";
import { Empty } from "./ui/Empty";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";
import { Popover } from "./ui/Popover";
import { Select, SelectItem } from "./ui/Select";
import { StickyBar } from "./ui/StickyBar";
import { Textarea } from "./ui/Textarea";
import { Tooltip } from "./ui/Tooltip";

type Tab = "findings" | "threads" | "diff";

const TABS: Tab[] = ["findings", "threads", "diff"];

// The tab lives in the url as well, so a refresh lands on the same panel.
function readTab(): Tab {
  const value = readUrl("tab");
  return TABS.includes(value as Tab) ? (value as Tab) : "findings";
}

export function SessionView() {
  const { session, prs, findings, activePrId, setActivePr, sessionId, settings, preparing } = useStore();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(readTab);
  const [threadCount, setThreadCount] = useState<number | null>(null);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [minConfidence, setMinConfidence] = useState(0);
  // One control for what a finding's life has come to. "live" is the default
  // and means the two that are still in play; the rest name a status exactly.
  const [status, setStatus] = useState<FindingStatus | "live" | "all">("live");
  // On by default: a re-review appends rather than replaces, and hiding the
  // earlier run makes findings look as though they vanished.
  const [showOldRuns, setShowOldRuns] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The filter row of whichever tab is open follows the scroll: on the way down
  // it gets out of the way of the list, on the way back up it is there again
  // without having to reach the top of it.
  const [barHidden, setBarHidden] = useState(false);
  const lastScroll = useRef(0);
  // The strip of pull requests scrolls sideways, so once a session holds a
  // dozen the one in use can be off screen. The list button reaches any of
  // them, and whatever makes a tab active brings it back into view.
  const [prListOpen, setPrListOpen] = useState(false);
  // Threads are fetched from the host, not streamed, so a turn that changes
  // what the author said leaves the tab stale. Bumping this re-reads them.
  const [threadsRead, setThreadsRead] = useState(0);
  const prTabs = useRef(new Map<string, HTMLButtonElement>());
  // The strip of pull requests is swiped, not scrolled by a bar: it is one row
  // high, and a bar under it would take as much room as the tabs themselves.
  const prStrip = useDragScroll<HTMLDivElement>();

  // A selection is meaningful only in the PR currently on screen. Keeping it
  // across navigation makes bulk actions affect invisible findings.
  useEffect(() => setSelected(new Set()), [sessionId, activePrId]);

  useEffect(() => {
    if (activePrId) prTabs.current.get(activePrId)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activePrId]);

  // A new list starts at the top, so the row starts shown.
  useEffect(() => {
    lastScroll.current = 0;
    setBarHidden(false);
  }, [sessionId, activePrId, tab]);

  const pr = prs.find((item) => item.id === activePrId) ?? null;
  // Every word about a pull request comes from its own host, not from whichever
  // host the dashboard happens to have been started in.
  const host = useHost(pr?.provider);

  useEffect(() => {
    let current = true;
    setThreadCount(null);
    if (!pr) return () => { current = false; };
    void api
      .threads(pr.id, true)
      .then((threads) => current && setThreadCount(threads.length))
      .catch(() => current && setThreadCount(null));
    return () => { current = false; };
  }, [pr?.id]);

  const prFindings = useMemo(
    () => findings.filter((finding) => (pr ? finding.sessionPrId === pr.id : true)),
    [findings, pr],
  );

  const visibleFindings = useMemo(
    () =>
      prFindings
        .filter((finding) => severity === "all" || finding.severity === severity)
        .filter((finding) => finding.confidence >= minConfidence)
        .filter((finding) => showOldRuns || !finding.superseded)
        .filter((finding) =>
          status === "all"
            ? true
            : status === "live"
              ? finding.status === "open" || finding.status === "posted"
              : finding.status === status,
        )
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, suggestion: 2 };
          return order[a.severity] - order[b.severity] || b.confidence - a.confidence;
        }),
    [prFindings, severity, minConfidence, status, showOldRuns],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleFindings.map((finding) => finding.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleFindings]);

  const selectedIds = useMemo(
    () => visibleFindings.filter((finding) => selected.has(finding.id)).map((finding) => finding.id),
    [visibleFindings, selected],
  );

  // How many of the popover's filters are away from their default, so the
  // button still says that something is being hidden while it is closed.
  const filterCount = (minConfidence > 0 ? 1 : 0) + (status !== "live" ? 1 : 0) + (showOldRuns ? 0 : 1);

  /** The only bulk decision that stays inside the dashboard. */
  const dismissSelected = async () => {
    const ids = selectedIds;
    const { ok } = await confirm({
      title: `Dismiss ${ids.length} finding${ids.length === 1 ? "" : "s"}`,
      description: "Hides them from the list. Nothing is sent to the agent or to the pull request.",
      noteLabel: null,
      confirmLabel: "Dismiss",
    });
    if (!ok) return;
    setSelected(new Set());
    for (const id of ids) await api.setFindingStatus(id, "dismissed");
  };

  // Nothing open is the first thing a new reviewer sees, so it is the walk
  // through the tool rather than a line saying there is nothing here.
  if (!session || !sessionId) {
    return (
      <div className="flex-1 overflow-auto">
        <GoldenPath />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <SessionTitle id={session.id} title={session.title} />
          <div className="text-[11px] text-muted-foreground">
            {prs.length} PR{prs.length === 1 ? "" : "s"} · {findings.length} findings
            {settings?.showCost && session.costUsd > 0 ? ` · $${session.costUsd.toFixed(2)}` : ""}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* The PRs are typed in the confirmation, beside the prompt they end
              up in, so there is one step and one place to read it. */}
          <AgentButton
            action="review"
            inputParam="request"
            chooseProfile
            autoAction="review.prepare"
            noneAction="review.none"
            noteLabel="Which pull requests, or what to review"
            notePlaceholder="96632 96633, a PR URL from any organisation, or a sentence describing what to review"
          >
            <Plus size={12} /> Add PRs
          </AgentButton>
          <AgentButton
            action="review"
            params={{ request: "" }}
            chooseProfile
            autoAction="profiles.suggest"
            noneAction="review.none"
            variant="foreground"
            disabled={!prs.length}
            notePlaceholder="Focus on the migration, and ignore the generated files."
          >
            <Play size={12} /> Review all
          </AgentButton>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {/* Anchored at the left, out of the scrolling strip: every pull request
            in the session, whichever one the strip happens to be showing. */}
        {prs.length > 0 && (
          <Popover
            open={prListOpen}
            onOpenChange={setPrListOpen}
            trigger={
              <Button variant="ghost" size="icon" className="shrink-0" title="All pull requests">
                <List size={13} />
              </Button>
            }
          >
            <div className="max-h-80 w-80 space-y-0.5 overflow-y-auto">
              {prs.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActivePr(item.id);
                    setPrListOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                    activePrId === item.id ? "bg-muted font-medium" : "hover:bg-muted",
                  )}
                >
                  <span className="shrink-0 font-mono">#{item.prId}</span>
                  <span className="min-w-0 flex-1 truncate">{item.title ?? item.repo}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{item.repo}</span>
                </button>
              ))}
            </div>
          </Popover>
        )}

        <div
          ref={prStrip.ref}
          {...prStrip.props}
          className="no-scrollbar flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 overflow-x-auto active:cursor-grabbing"
        >
          {prs.map((item) => (
            <Tooltip key={item.id} content={item.title} asChild>
              <button
                ref={(node) => {
                  if (node) prTabs.current.set(item.id, node);
                  else prTabs.current.delete(item.id);
                }}
                onClick={() => setActivePr(item.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                  activePrId === item.id
                    ? "bg-primary font-medium text-primary-foreground hover:bg-primary/90"
                    : "hover:bg-muted",
                )}
              >
                {/* On the active tab the fill already carries the colour, so the
                    state icon rides the label rather than fighting it. */}
                <GitPullRequest
                  size={12}
                  className={cn(
                    item.state === "reviewing" && "animate-status-pulse",
                    activePrId !== item.id && [
                      item.state === "error" && "text-destructive",
                      item.state === "reviewing" && "text-primary",
                      item.state === "reviewed" && "text-severity-suggestion",
                    ],
                  )}
                />
                <span>#{item.prId}</span>
                {/* The repository rather than the title: pull requests in one
                    session usually share a ticket and differ by where they
                    land. The title is a hover away. */}
                <span className="max-w-[180px] truncate opacity-70">{item.repo}</span>
              </button>
            </Tooltip>
          ))}
          {Object.entries(preparing)
            .filter(([prId]) => !prs.some((item) => item.prId === Number(prId)))
            .map(([prId]) => (
              <span
                key={prId}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <Loader2 size={12} className="animate-spin" />#{prId}
              </span>
            ))}
          {!prs.length && !Object.keys(preparing).length && (
            <Empty variant="inline" title="No PRs in this session yet." className="py-0" />
          )}
        </div>
      </div>

      {pr && (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
          {/* Branch names get long; truncating keeps the buttons on this row. */}
          {/* The repository names the tab above, so this row is the branches alone. */}
          <Tooltip content={`${pr.sourceBranch} → ${pr.targetBranch}`} className="min-w-0">
            <span className="truncate font-mono text-muted-foreground">
              {pr.sourceBranch} → {pr.targetBranch}
            </span>
          </Tooltip>
          {/* Not a request to the agent, so it sits with the name it opens, not with the buttons. */}
          {/* The link is built by the server, which is the one place that knows
              how each host spells a pull request URL. */}
          <Tooltip content={`Open this pull request in ${host.label}`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(pr.webUrl, "_blank", "noreferrer")}
            >
              <ExternalLink size={12} />
            </Button>
          </Tooltip>
          {pr.error && <span className="truncate text-destructive">{pr.error}</span>}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Everything here is a request to the agent; hover shows the words. */}
            {/* A re-review is a review: the criteria and how hard to look are
                picked in its confirmation, like any other review. */}
            <AgentButton
              action="pr.review"
              params={{ prId: pr.prId, repo: pr.repo }}
              chooseProfile
              noneAction="pr.review.none"
              disabled={pr.state === "reviewing"}
              notePlaceholder="Focus on the migration, and ignore the generated files."
            >
              <Play size={12} /> {pr.state === "reviewed" ? "Re-review" : "Review"}
            </AgentButton>
            {/* Wait for author (vote -5): the dashboard never shows the result, so
                the button said nothing back. Still available through the chat box.
            <AgentButton action="pr.waiting" params={{ prId: pr.prId, repo: pr.repo }}>
              <Clock size={12} /> Wait for author
            </AgentButton>
            */}
            {/* The turn after the author says they have fixed everything: pull
                what landed, read the answers, and settle each finding. */}
            <AgentButton
              action="pr.recheck"
              params={{ prId: pr.prId, repo: pr.repo }}
              disabled={pr.state === "reviewing"}
              notePlaceholder="They only answered the auth ones; ignore the rest for now."
              onDone={() => setThreadsRead((count) => count + 1)}
            >
              <RefreshCw size={12} /> Re-check fixes
            </AgentButton>
            <AgentButton action="pr.approve" params={{ prId: pr.prId, repo: pr.repo }} variant="success">
              <ThumbsUp size={12} /> Approve
            </AgentButton>
          </div>
        </div>
      )}

      <nav className="flex items-center gap-1 border-b px-2 py-1">
        {TABS.map((item) => {
          const count = item === "findings" ? prFindings.length : item === "threads" ? threadCount : pr?.files.length;
          return (
            <button
              key={item}
              onClick={() => {
                setTab(item);
                writeUrl({ tab: item });
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition-colors hover:bg-muted",
                tab === item && "bg-muted font-medium",
              )}
            >
              {item}
              {/* The files the review actually looked at, after the profile's
                  include and exclude globs, not every file on the PR. */}
              {item === "diff" && <span className="text-[10px] font-normal normal-case text-muted-foreground">in scope</span>}
              {count != null && count > 0 && (
                <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div
        className="flex-1 overflow-y-auto p-3"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          const delta = top - lastScroll.current;
          // A few pixels of wobble, or a rubber-band bounce at the end, should
          // not flip the row.
          if (Math.abs(delta) < 8) return;
          lastScroll.current = top;
          setBarHidden(delta > 0 && top > 48);
        }}
      >
        {!pr && <Empty icon={GitPullRequest} title="No PR selected." hint="Add a PR to this session to start reviewing." />}
        {pr && tab === "findings" && (
          <div className="space-y-2">
            <StickyBar hidden={barHidden} className="text-[11px]">
              <Select
                value={severity}
                onValueChange={(value) => setSeverity(value as Severity | "all")}
                className="w-auto"
              >
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="suggestion">Suggestion</SelectItem>
              </Select>

              {/* Confidence and the what-to-include toggles share one button: they
                  are set once and then left alone. */}
              <Popover
                trigger={
                  <Button variant={filterCount ? "primary" : "muted"}>
                    <SlidersHorizontal size={12} /> Filters
                    {filterCount > 0 && <span className="tabular-nums">({filterCount})</span>}
                  </Button>
                }
              >
                <div className="w-56 space-y-3">
                  <label className="block space-y-1 text-xs">
                    <span className="flex items-center justify-between">
                      Min confidence
                      <span className="tabular-nums text-muted-foreground">{Math.round(minConfidence * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={minConfidence}
                      onChange={(event) => setMinConfidence(Number(event.target.value))}
                      className="w-full accent-primary"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      Hides findings the agent could not prove.
                    </span>
                  </label>
                  {/* Dismissed and resolved are hidden by default rather than
                      gone: a re-check moves findings between these, and the
                      list of what it resolved is worth being able to read. */}
                  <label className="block space-y-1 text-xs">
                    <span>Status</span>
                    <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                      <SelectItem value="live">Open and posted</SelectItem>
                      <SelectItem value="all">Every status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="posted">Posted</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="dismissed">Dismissed</SelectItem>
                    </Select>
                  </label>
                  {prFindings.some((finding) => finding.superseded) && (
                    <Checkbox label="Show earlier runs" checked={showOldRuns} onCheckedChange={setShowOldRuns} />
                  )}
                </div>
              </Popover>

              {/* What was the selection banner: it sits in the row it belongs to. */}
              {selectedIds.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selectedIds.length} selected</span>
                  <button className="text-muted-foreground underline" onClick={() => setSelected(new Set())}>
                    clear
                  </button>
                  <AgentButton
                    action="findings.challenge"
                    params={{ findingIds: selectedIds }}
                    notePlaceholder="I think these are false positives: the guard runs in middleware."
                    onDone={() => setSelected(new Set())}
                  >
                    Challenge…
                  </AgentButton>
                  <AgentButton
                    action="findings.post"
                    params={{ findingIds: selectedIds }}
                    chooseCommentStyle
                    notePlaceholder="Group the two auth ones into a single comment."
                    onDone={() => setSelected(new Set())}
                  >
                    Post to PR…
                  </AgentButton>
                  {/* Dashboard bookkeeping, so no prompt, but it still asks:
                      it takes a whole selection off the list at once. */}
                  <Button variant="destructive" onClick={dismissSelected}>
                    Dismiss
                  </Button>
                </div>
              )}
            </StickyBar>
            {visibleFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                selected={selected.has(finding.id)}
                onSelect={(isSelected) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (isSelected) next.add(finding.id);
                    else next.delete(finding.id);
                    return next;
                  })
                }
              />
            ))}
            {!visibleFindings.length && (
              <Empty
                icon={SearchCheck}
                title={pr.state === "reviewing" ? "Reviewing…" : "No findings to show."}
                hint={
                  pr.state === "reviewing"
                    ? "Findings appear here as the agent reports them."
                    : prFindings.length
                      ? "Every finding is hidden by the filters above."
                      : undefined
                }
              />
            )}
          </div>
        )}
        {pr && tab === "threads" && (
          <Threads key={`${pr.id}:${threadsRead}`} pr={pr} onCount={setThreadCount} barHidden={barHidden} />
        )}
        {pr && tab === "diff" && <DiffPanel pr={pr} />}
      </div>
    </div>
  );
}

/** The name is generated from the PRs; click it to take it over by hand. */
function SessionTitle({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => setDraft(title), [title]);

  const commit = async () => {
    setEditing(false);
    if (draft.trim() && draft !== title) await api.updateSession(id, { title: draft.trim() });
  };

  if (!editing) {
    return (
      <Tooltip content="Click to rename">
        <button className="truncate font-medium hover:underline" onClick={() => setEditing(true)}>
          {title}
        </button>
      </Tooltip>
    );
  }
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") void commit();
        if (event.key === "Escape") {
          setDraft(title);
          setEditing(false);
        }
      }}
    />
  );
}

