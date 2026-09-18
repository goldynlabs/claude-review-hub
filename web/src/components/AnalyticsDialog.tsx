import { useEffect, useMemo, useState } from "react";
import { BarChart3, ExternalLink, GitPullRequest, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import type { Analytics, AnalyticsBucket, AnalyticsPr, PrThreadStats, ProviderKind, ThreadStats } from "../lib/types";
import { Button } from "./ui/Button";
import { Empty } from "./ui/Empty";
import { Modal } from "./ui/Modal";
import { Tooltip } from "./ui/Tooltip";

type Tab = "overview" | "prs" | "findings";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  {
    id: "overview",
    label: "Overview",
    hint: "Everything this tool has reviewed so far, across every session.",
  },
  {
    id: "prs",
    label: "Pull requests",
    hint: "One row per pull request: what was found on it, and what is still open on the host.",
  },
  {
    id: "findings",
    label: "Findings",
    hint: "What the reviews report, and how much of it reaches the pull request.",
  },
];

const SEVERITY_FILL: Record<string, string> = {
  critical: "hsl(var(--severity-critical))",
  warning: "hsl(var(--severity-warning))",
  suggestion: "hsl(var(--severity-suggestion))",
};

const STATUS_FILL: Record<string, string> = {
  open: "hsl(var(--severity-warning))",
  posted: "hsl(var(--primary))",
  resolved: "hsl(var(--success))",
  dismissed: "hsl(var(--muted-foreground))",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * A headline number with its name under it. Filled, never outlined. `value` is
 * an em dash when there is nothing to count: a rate over no findings at all is
 * not 0%, it is a number that does not exist yet, and saying 0% would read as
 * "we posted nothing", which is a different and wrong claim.
 */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const missing = value === "—";
  const tile = (
    <div className="w-full rounded-lg bg-muted px-3 py-2.5">
      <div
        className={cn(
          "text-lg font-semibold leading-tight",
          missing ? "text-muted-foreground/60" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
  // The tooltip wraps the tile in a span. That span is the grid item and so
  // stretches to the column on its own, but the tile inside it is a flex item
  // and would sit at the width of its own text, leaving the fill short of the
  // column; `w-full` above is what spans it.
  return hint ? <Tooltip content={hint}>{tile}</Tooltip> : tile;
}

/**
 * A row of bars, each as wide as its share of the largest one. Hand-drawn with
 * divs rather than a charting library: the shapes here are this simple.
 */
function Bars({
  data,
  fill,
  secondaryLabel,
  empty,
}: {
  data: Array<{ key: string; total: number; posted?: number }>;
  fill?: (key: string) => string;
  secondaryLabel?: string;
  /** What to say when every bar would be zero. */
  empty: string;
}) {
  const largest = Math.max(0, ...data.map((item) => item.total));
  const max = Math.max(1, largest);
  // Severity, status and confidence always come back with all their buckets,
  // so "no data" here is every total at zero, not an empty list. Without this
  // the panel draws a full set of bars of length nothing, which reads as a
  // rendering fault rather than as an empty database.
  if (!data.length || largest === 0) return <Empty variant="inline" title={empty} className="px-0" />;
  return (
    <div className="space-y-1.5">
      {data.map((item) => (
        <div key={item.key} className="flex items-center gap-2">
          <div className="w-32 shrink-0 truncate text-[11px] text-muted-foreground" title={item.key}>
            {item.key}
          </div>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded"
              style={{ width: `${(item.total / max) * 100}%`, background: fill?.(item.key) ?? "hsl(var(--primary))" }}
            />
            {/* The share that reached the pull request, drawn over the same bar. */}
            {item.posted !== undefined && item.posted > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded bg-foreground/25"
                style={{ width: `${(item.posted / max) * 100}%` }}
              />
            )}
          </div>
          <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-foreground">
            {item.total}
            {item.posted !== undefined && (
              <span className="text-muted-foreground"> / {item.posted}</span>
            )}
          </div>
        </div>
      ))}
      {secondaryLabel && <p className="pt-0.5 text-[10px] text-muted-foreground">{secondaryLabel}</p>}
    </div>
  );
}

/** Findings by severity, as one ring. Plain SVG arcs, no library. */
function Donut({ data, empty }: { data: AnalyticsBucket[]; empty: string }) {
  const total = data.reduce((sum, item) => sum + item.total, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  // A ring of nothing is not a chart. With no findings the legend would read
  // "critical 0 (0%)" three times over, which says less than one sentence does.
  if (!total) return <Empty variant="inline" title={empty} className="px-0" />;

  return (
    <div className="flex w-full items-center gap-5">
      <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0 -rotate-90">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
        {data.map((item) => {
          const length = (item.total / total) * circumference;
          const arc = (
            <circle
              key={item.key}
              cx="55"
              cy="55"
              r={radius}
              fill="none"
              stroke={SEVERITY_FILL[item.key] ?? "hsl(var(--primary))"}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return arc;
        })}
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        {data.map((item) => (
          <div key={item.key} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: SEVERITY_FILL[item.key] ?? "hsl(var(--primary))" }}
            />
            <span className="capitalize text-muted-foreground">{item.key}</span>
            <span className="ml-auto tabular-nums text-foreground">{item.total}</span>
            <span className="w-10 text-right text-muted-foreground">{percent(item.total / total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Thirty days of columns: pull requests added, and findings reported. The
 * width goes on each tooltip's own span, because in this flex row that span is
 * the item; a class on the column inside it would size nothing.
 */
function Activity({ data, empty }: { data: Analytics["activity"]; empty: string }) {
  const largest = Math.max(0, ...data.map((day) => Math.max(day.prs, day.findings)));
  const max = Math.max(1, largest);
  // Thirty columns of zero height is a blank strip with a date either side; it
  // looks like the chart failed rather than like a quiet month.
  if (!largest) return <Empty variant="inline" title={empty} className="px-0" />;
  return (
    <div className="w-full">
      <div className="flex h-24 items-end gap-[3px]">
        {data.map((day) => (
          <Tooltip
            key={day.date}
            content={`${day.date}: ${day.prs} PR, ${day.findings} findings`}
            className="h-full flex-1"
          >
            <div className="flex h-full w-full flex-col justify-end gap-[2px]">
              <div
                className="w-full rounded-t-sm bg-primary"
                style={{ height: `${(day.findings / max) * 70}%` }}
              />
              <div
                className="w-full rounded-t-sm bg-foreground/30"
                style={{ height: `${(day.prs / max) * 25}%` }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-primary" /> findings
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-foreground/30" /> pull requests
          </span>
        </span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/** A count in a filled pill; grey at zero so a busy row still reads at a glance. */
function Pill({ value, tone }: { value: number; tone?: "warn" | "good" | "bad" }) {
  const fill =
    value === 0
      ? "bg-muted text-muted-foreground"
      : tone === "bad"
        ? "bg-destructive/15 text-destructive"
        : tone === "warn"
          ? "bg-primary/15 text-primary"
          : tone === "good"
            ? "bg-success/15 text-success"
            : "bg-muted text-foreground";
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] tabular-nums", fill)}>{value}</span>;
}

function PrTable({ prs, threads }: { prs: AnalyticsPr[]; threads: Map<string, PrThreadStats> }) {
  const connections = useStore((state) => state.connections);
  const hostLabel = (provider: string) =>
    connections.find((connection) => connection.provider === (provider as ProviderKind))?.label ??
    (provider === "github" ? "GitHub" : "Azure DevOps");

  if (!prs.length)
    return (
      <Empty
        icon={GitPullRequest}
        title="No pull request has been added yet."
        hint="Paste a pull request URL in the sidebar to start a review; it appears here once it does."
      />
    );

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-card text-left text-muted-foreground">
        <tr>
          <th className="py-1.5 pr-2 font-medium">Pull request</th>
          <th className="py-1.5 pr-2 font-medium">Repo</th>
          <th className="py-1.5 pr-2 font-medium">Host</th>
          <th className="py-1.5 pr-2 font-medium">PR status</th>
          <th className="py-1.5 pr-2 font-medium">Review</th>
          <th className="py-1.5 pr-2 text-right font-medium">Findings</th>
          <th className="py-1.5 pr-2 text-right font-medium">Posted</th>
          <th className="py-1.5 pr-2 text-right font-medium">Critical</th>
          <th className="py-1.5 pr-2 text-right font-medium">Active threads</th>
          <th className="py-1.5 text-right font-medium">Ours open</th>
        </tr>
      </thead>
      <tbody>
        {prs.map((pr) => {
          const thread = threads.get(pr.id);
          return (
            <tr key={pr.id} className="odd:bg-muted/40">
              <td className="max-w-[18rem] py-1.5 pr-2">
                <a
                  href={pr.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 truncate text-foreground hover:text-primary"
                  title={pr.title ?? undefined}
                >
                  <span className="tabular-nums text-muted-foreground">#{pr.prId}</span>
                  <span className="truncate">{pr.title ?? "(untitled)"}</span>
                  <ExternalLink size={10} className="shrink-0 text-muted-foreground" />
                </a>
              </td>
              <td className="py-1.5 pr-2 text-muted-foreground">{pr.repo}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{hostLabel(pr.provider)}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{pr.prStatus ?? "—"}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{pr.state}</td>
              <td className="py-1.5 pr-2 text-right">
                <Pill value={pr.findings} />
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Pill value={pr.posted} tone="warn" />
              </td>
              <td className="py-1.5 pr-2 text-right">
                <Pill value={pr.critical} tone="bad" />
              </td>
              <td className="py-1.5 pr-2 text-right">
                {thread?.error ? (
                  <Tooltip content={thread.error}>
                    <span className="text-destructive">!</span>
                  </Tooltip>
                ) : thread?.fetchedAt ? (
                  <Pill value={thread.active} tone="warn" />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 text-right">
                {thread?.fetchedAt ? (
                  <Pill value={thread.oursActive} tone="warn" />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * What the tool has done, counted. The numbers come out of the database and
 * appear at once; the comment threads on each pull request cannot, so the
 * cached counts are shown first and the live read replaces them when it lands.
 */
export function AnalyticsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Analytics | null>(null);
  const [threads, setThreads] = useState<ThreadStats | null>(null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLive = () => {
    setFetchingLive(true);
    api
      .threadStats(true)
      .then(setThreads)
      .catch(() => undefined)
      .finally(() => setFetchingLive(false));
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api.analytics(), api.threadStats(false)])
      .then(([counts, cached]) => {
        if (!alive) return;
        setData(counts);
        setThreads(cached);
        loadLive();
      })
      .catch((cause: Error) => alive && setError(cause.message));
    return () => {
      alive = false;
    };
  }, []);

  const threadMap = useMemo(
    () => new Map((threads?.prs ?? []).map((item) => [item.id, item])),
    [threads],
  );

  const threadTotals = useMemo(() => {
    const list = threads?.prs ?? [];
    return {
      active: list.reduce((sum, item) => sum + item.active, 0),
      total: list.reduce((sum, item) => sum + item.total, 0),
      oursActive: list.reduce((sum, item) => sum + item.oursActive, 0),
      known: list.filter((item) => item.fetchedAt).length,
    };
  }, [threads]);

  const active = TABS.find((item) => item.id === tab);
  const totals = data?.totals;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Analytics"
      maxWidth="max-w-none"
      height="h-[calc(100vh-4rem)]"
      headerAction={
        <Tooltip content="Read every pull request's comment threads from its host again">
          <Button variant="ghost" size="icon" onClick={loadLive} disabled={fetchingLive}>
            <RefreshCw size={14} className={fetchingLive ? "animate-spin" : undefined} />
          </Button>
        </Tooltip>
      }
    >
      <div className="sticky top-0 z-10 -mx-5 mb-3 bg-card px-5 pb-2">
        <nav className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs hover:bg-muted",
                tab === item.id && "bg-muted font-medium",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {active && <p className="mt-2 text-[11px] text-muted-foreground">{active.hint}</p>}
        {/* Says plainly which numbers are on screen, and goes once they are live. */}
        {threads && !threads.live && (
          <p className="mt-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            Comment counts are the ones last read from the host
            {fetchingLive ? "; reading them again now…" : ". Refresh to read them again."}
          </p>
        )}
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}
      {!data && !error && <div className="text-xs text-muted-foreground">Loading…</div>}

      {/* Nothing has ever been reviewed on this machine: one sentence beats
          three tabs of zeros, each of which would have to be read to learn it. */}
      {data && totals && !totals.sessions && (
        <Empty
          icon={BarChart3}
          title="Nothing has been reviewed yet."
          hint="Start a review from the sidebar. Once a pull request has been through it, this panel counts what was found, what reached the host, and what is still open."
        />
      )}

      {data && totals && !!totals.sessions && tab === "overview" && (
        <div className="space-y-5 pb-2">
          {/* Six across on any screen this modal is wide enough for, and they
              share the whole row rather than sitting in a cluster on the left. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Pull requests" value={String(totals.prs)} />
            <Stat
              label="Reviewed"
              value={String(totals.prsReviewed)}
              hint="Pull requests whose review run finished."
            />
            <Stat
              label="Findings"
              value={String(totals.findings)}
              hint={
                totals.superseded
                  ? `${totals.superseded} more from earlier reviews of the same pull requests are kept but not counted.`
                  : undefined
              }
            />
            <Stat
              label="Posted to the PR"
              value={totals.findings ? percent(totals.postRate) : "—"}
              hint={
                totals.findings
                  ? `${totals.posted} of ${totals.findings} findings were posted as a comment.`
                  : "No findings yet, so there is no rate to report."
              }
            />
            <Stat
              label="Active threads"
              value={threadTotals.known ? String(threadTotals.active) : "—"}
              hint={
                threadTotals.known
                  ? `${threadTotals.oursActive} of them are threads this tool opened. Read from ${threadTotals.known} pull requests.`
                  : "No pull request's threads have been read yet."
              }
            />
            <Stat
              label="Spent"
              value={totals.sessions ? `$${totals.costUsd.toFixed(2)}` : "—"}
              hint={`Across ${totals.sessions} sessions.`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-xs font-semibold">Findings by severity</h3>
              <Donut data={data.bySeverity} empty="No findings have been reported yet." />
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold">Where each finding ended up</h3>
              <Bars
                data={data.byStatus.map((item) => ({ key: item.key, total: item.total }))}
                fill={(key) => STATUS_FILL[key] ?? "hsl(var(--primary))"}
                empty="Nothing has been posted, resolved or dismissed yet."
              />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Findings per PR" value={totals.prs ? totals.avgFindingsPerPr.toFixed(1) : "—"} />
                <Stat
                  label="Mean confidence"
                  value={totals.findings ? percent(totals.avgConfidence) : "—"}
                />
                <Stat
                  label="Still open"
                  value={String(totals.open)}
                  hint="Findings neither posted, resolved nor dismissed."
                />
              </div>
            </section>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold">Last 30 days</h3>
            <Activity data={data.activity} empty="Nothing was reviewed in the last 30 days." />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-xs font-semibold">Pull request status</h3>
              <Bars
                data={data.byPrStatus.map((item) => ({ key: item.key, total: item.count }))}
                empty="No pull request has been added yet."
              />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold">By host</h3>
              <Bars
                data={data.byProvider.map((item) => ({
                  key: item.key === "github" ? "GitHub" : "Azure DevOps",
                  total: item.prs,
                }))}
                empty="No pull request has been added yet."
              />
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {data.byProvider.map((item) => `${item.prs} PR, ${item.findings} findings`).join(" · ") || "—"}
              </p>
            </section>
          </div>
        </div>
      )}

      {data && !!totals?.sessions && tab === "prs" && (
        <div className="pb-2">
          <PrTable prs={data.prs} threads={threadMap} />
        </div>
      )}

      {data && !!totals?.sessions && tab === "findings" && (
        <div className="space-y-5 pb-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold">By dimension</h3>
            <Bars
              data={data.byDimension}
              secondaryLabel="total / posted to the pull request"
              empty="No findings have been reported yet."
            />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold">By severity</h3>
            <Bars
              data={data.bySeverity}
              fill={(key) => SEVERITY_FILL[key] ?? "hsl(var(--primary))"}
              secondaryLabel="total / posted to the pull request"
              empty="No findings have been reported yet."
            />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold">By confidence</h3>
            <Bars
              data={data.byConfidence}
              secondaryLabel="total / posted to the pull request"
              empty="No findings have been reported yet."
            />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold">Review state of every pull request</h3>
            <Bars
              data={data.byPrState.map((item) => ({ key: item.key, total: item.count }))}
              empty="No pull request has been added yet."
            />
          </section>
        </div>
      )}
    </Modal>
  );
}
