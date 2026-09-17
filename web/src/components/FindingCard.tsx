import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, MessageSquarePlus, Quote, Swords, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { cn, confidenceLabel } from "../lib/cn";
import type { Finding, Severity } from "../lib/types";
import { AgentButton, LocalTooltip } from "./AgentButton";
import { useConfirm } from "./Confirm";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { CopyButton, CopyId } from "./ui/CopyId";
import { StatusBadge } from "./ui/StatusBadge";
import { Tooltip } from "./ui/Tooltip";

const severityTone: Record<Severity, "critical" | "warning" | "suggestion"> = {
  critical: "critical",
  warning: "warning",
  suggestion: "suggestion",
};
const severityBorder: Record<Severity, string> = {
  critical: "border-l-severity-critical",
  warning: "border-l-severity-warning",
  suggestion: "border-l-severity-suggestion",
};

const fileLocation = (finding: Finding) => `${finding.file}${finding.line ? `:${finding.line}` : ""}`;

export function FindingCard({
  finding,
  selected,
  onSelect,
}: {
  finding: Finding;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  const dimmed = finding.status === "dismissed" || finding.status === "resolved" || finding.superseded;

  /** Dismiss is the one decision here that stays inside the dashboard. */
  const dismiss = async () => {
    const { ok } = await confirm({
      title: "Dismiss this finding",
      description: "Hides it from the list. Nothing is sent to the agent or to the pull request.",
      noteLabel: null,
      confirmLabel: "Dismiss",
    });
    if (ok) await api.setFindingStatus(finding.id, "dismissed");
  };

  return (
    <div
      className={cn(
        "group card overflow-hidden border-l-2 animate-fade-in-up",
        severityBorder[finding.severity],
        dimmed && "opacity-55",
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          {/* Selecting is how bulk actions are aimed; it never opens the card. */}
          {onSelect && (
            <Checkbox
              checked={Boolean(selected)}
              onCheckedChange={onSelect}
              ariaLabel={`Select ${finding.title}`}
              className="mt-1"
            />
          )}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(!open);
              }
            }}
            className="flex min-w-0 flex-1 flex-col items-start text-left"
          >
            <div className="flex min-w-0 items-center gap-2">
              {open ? (
                <ChevronDown size={14} className="shrink-0" />
              ) : (
                <ChevronRight size={14} className="shrink-0" />
              )}
              <div className="min-w-0 flex-1 truncate font-medium leading-snug">{finding.title}</div>
            </div>
            <div className="ml-[22px] min-w-0">
              <div className="mt-1 flex min-w-0 items-baseline gap-1.5 font-mono text-xs text-muted-foreground">
                <CopyId id={finding.id} copyText={`Finding ${finding.id}`} className="shrink-0" />
                <Label>File</Label>
                <span className="min-w-0 flex-1 truncate">{fileLocation(finding)}</span>
                <CopyButton text={fileLocation(finding)} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Label>Severity</Label>
                  <StatusBadge tone={severityTone[finding.severity]} className="capitalize">
                    {finding.severity}
                  </StatusBadge>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Label>Dimension</Label>
                  <StatusBadge tone="off">{finding.dimension}</StatusBadge>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Label>Confidence</Label>
                  <ConfidenceBar value={finding.confidence} />
                </span>
                {finding.superseded && <StatusBadge tone="off">earlier run</StatusBadge>}
                {finding.status !== "open" && (
                  <StatusBadge tone="off" className="capitalize">
                    {finding.status}
                  </StatusBadge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Own row, revealed on hover: the list stays readable when you are
            scanning it, and the row still takes its height so nothing shifts. */}
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-end gap-2",
            "invisible group-hover:visible group-focus-within:visible",
          )}
        >
            <AgentButton
              action="finding.challenge"
              params={{ findingId: finding.id }}
              notePlaceholder="The guard already runs in the middleware, line 22."
            >
              <Swords size={12} /> Challenge
            </AgentButton>
            <AgentButton
              action="finding.post"
              params={{ findingId: finding.id }}
              disabled={finding.status === "posted"}
            >
              <MessageSquarePlus size={12} /> Post to PR
            </AgentButton>
            {/* Resolving a posted finding should close its thread on the pull
                request too, which only the agent can do. */}
            <AgentButton
              action="finding.resolve"
              params={{ findingId: finding.id }}
              disabled={finding.status === "resolved"}
              notePlaceholder="Fixed in the follow-up commit."
            >
              <Check size={12} /> Resolve
            </AgentButton>
            <LocalTooltip what="Hides this finding from the list. Nothing is sent to the agent or to the pull request.">
              <Button variant="destructive" onClick={dismiss}>
                <Trash2 size={12} /> Dismiss
              </Button>
            </LocalTooltip>
          </div>
          {open && (
            <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto text-sm">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Description</div>
                <p className="whitespace-pre-wrap font-serif leading-relaxed text-foreground/90">{finding.detail}</p>
              </div>

              {finding.suggestedFix && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Suggested fix</div>
                  <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                    {finding.suggestedFix}
                  </pre>
                </div>
              )}

              <Evidence finding={finding} />
              <Verdicts finding={finding} />
            </div>
          )}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">{children}:</span>;
}

function ConfidenceBar({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const tone = value >= 0.8 ? "bg-severity-critical" : value >= 0.5 ? "bg-severity-warning" : "bg-muted-foreground";
  return (
    <Tooltip content={`Confidence ${percent}%. Below 50% means the agent suspected it but could not prove it.`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
        </span>
        <span className="tabular-nums">
          {percent}% {confidenceLabel(value)}
        </span>
      </span>
    </Tooltip>
  );
}

function Evidence({ finding }: { finding: Finding }) {
  if (!finding.evidence.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Evidence</div>
      {finding.evidence.map((item) => (
        <div key={item.id} className="rounded-md bg-muted p-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <StatusBadge tone="off" className="capitalize">
              {item.kind}
            </StatusBadge>
            {item.file && (
              <span className="font-mono">
                {item.file}
                {item.line_start ? `:${item.line_start}` : ""}
                {item.line_end && item.line_end !== item.line_start ? `-${item.line_end}` : ""}
              </span>
            )}
            {item.source && <span className="font-mono">{item.source}</span>}
          </div>
          {item.snippet && <pre className="overflow-x-auto font-mono text-xs leading-relaxed">{item.snippet}</pre>}
          {item.quote && (
            <blockquote className="flex gap-1.5 font-serif text-xs italic text-foreground/80">
              <Quote size={11} className="mt-0.5 shrink-0" />
              {item.quote}
            </blockquote>
          )}
          {item.note && <div className="font-serif text-xs text-foreground/80">{item.note}</div>}
        </div>
      ))}
    </div>
  );
}

function Verdicts({ finding }: { finding: Finding }) {
  if (finding.verdicts.length <= 1) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">Confidence history</div>
      <ol className="space-y-1 border-l pl-3">
        {finding.verdicts.map((verdict, index) => (
          <li key={index} className="text-xs">
            <StatusBadge tone="off" className="mr-1.5 capitalize">
              {verdict.by}
            </StatusBadge>
            <span className="font-medium tabular-nums">{Math.round(verdict.confidence * 100)}%</span>
            <span className="ml-1.5 font-serif text-muted-foreground">{verdict.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
