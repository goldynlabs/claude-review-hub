import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Github,
  Info,
  Plug,
  RefreshCw,
  Settings,
  UserRound,
} from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import type { Connection, ProviderKind } from "../lib/types";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";
import { Tooltip } from "./ui/Tooltip";

const ICONS: Record<ProviderKind, typeof Building2> = { azure: Building2, github: Github };

/**
 * Below this many pixels of sidebar, the three buttons at the foot of it drop
 * their labels and stand as icons. The sidebar is dragged to a pixel width
 * rather than stepping through breakpoints, so this is a number and not a
 * media query. It is the width at which "Settings", "Analytics" and "How it
 * works" stop fitting side by side; under it they would each be shaved to an
 * ellipsis, and three ellipses say less than three icons with tooltips do.
 */
const LABELLED_MIN_WIDTH = 310;

/**
 * Connection status, always visible: which hosts this machine can reach, who
 * each one is signed in as, and which of them the repo being reviewed lives on.
 * Nothing here is typed in by hand.
 */
export function ConnectionsSection({
  collapsed,
  width,
  onOpenSettings,
  onOpenInspect,
  onOpenAnalytics,
}: {
  collapsed?: boolean;
  /** How wide the sidebar is right now; it decides whether labels fit. */
  width?: number;
  onOpenSettings: () => void;
  onOpenInspect: () => void;
  onOpenAnalytics: () => void;
}) {
  const { context, connections, setConnections } = useStore();
  const [detecting, setDetecting] = useState(false);

  const redetect = async () => {
    setDetecting(true);
    try {
      const result = await api.connections(true);
      setConnections({ context: result.context, connections: result.connections });
    } finally {
      setDetecting(false);
    }
  };

  // The host of the repo in front of us comes first; the others are only shown
  // when their CLI is actually installed, so a one-host machine reads as one.
  const active = connections.find((connection) => connection.provider === context.provider) ?? null;
  const others = connections.filter((connection) => connection !== active && connection.installed);
  const usable = connections.filter((connection) => connection.installed);

  // Wide enough for all three labels to stand side by side without shaving any
  // of them to an ellipsis. Below it they are icons.
  const labelled = (width ?? Number.POSITIVE_INFINITY) >= LABELLED_MIN_WIDTH;
  const footButtons = [
    { id: "settings", icon: Settings, label: "Settings", tooltip: "Settings", onClick: onOpenSettings },
    {
      id: "analytics",
      icon: BarChart3,
      label: "Analytics",
      tooltip: "Analytics: what has been reviewed, and what came of it",
      onClick: onOpenAnalytics,
    },
    {
      id: "inspect",
      icon: BookOpen,
      label: "How it works",
      tooltip: "How it works: every action, prompt and permission rule",
      onClick: onOpenInspect,
    },
  ];

  if (collapsed) {
    const summary = usable.length
      ? usable
          .map((connection) => `${connection.label}: ${connection.user?.displayName ?? "not signed in"}`)
          .join("\n")
      : "Neither the az nor the gh CLI is installed. Open Settings.";
    return (
      <Tooltip side="right" content={summary}>
        <Button variant="ghost" size="icon" onClick={onOpenSettings}>
          {usable.some((connection) => connection.signedIn) ? (
            <Plug size={15} />
          ) : (
            <CircleAlert size={15} className="text-destructive" />
          )}
        </Button>
      </Tooltip>
    );
  }

  return (
    <section className="border-t px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Plug size={12} className="text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Connections</span>
        <Tooltip content="Work out the host and the signed-in accounts again">
          <Button variant="ghost" size="icon" className="ml-auto p-1" onClick={redetect} disabled={detecting}>
            <RefreshCw size={11} className={cn(detecting && "animate-spin")} />
          </Button>
        </Tooltip>
      </div>

      <div className="space-y-2.5">
        {active && <Host connection={active} context={context} active />}
        {others.map((connection) => (
          <Host key={connection.provider} connection={connection} context={context} />
        ))}

        {/* Asked of the CLIs, not of the rows: there being nothing to list and
            there being no CLI on the machine are different facts, and this
            sentence is about the second one. */}
        {!usable.length && (
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <CircleAlert size={12} className="mt-0.5 shrink-0 text-destructive" />
            <span>
              Neither the <code>az</code> nor the <code>gh</code> CLI is installed, so nothing can be reviewed yet.
            </span>
          </div>
        )}

        {/* A CLI is there but the remote named neither host: the PR itself has
            to say which one is meant, and it is remembered afterwards. */}
        {!active && usable.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            This repo's origin remote is on neither host. Paste a full pull request URL and the host in it is
            remembered.
          </div>
        )}
      </div>

      {/* Three across the foot of the sidebar. Wide enough, they fill the row
          and each takes the width its own label needs, so none is padded out
          while another truncates. Too narrow for that, they drop to icons
          rather than to three ellipses; the tooltip carries the name either
          way, so nothing is lost but the reading. The sizing goes on the
          tooltip's own span, because that span is the flex item of this row;
          classes left on the button inside it would size nothing. */}
      <div className="mt-2 flex w-full items-center gap-1.5">
        {footButtons.map(({ id, icon: Icon, label, tooltip, onClick }) => (
          <Tooltip key={id} content={tooltip} className={labelled ? "min-w-0 flex-auto" : "flex-1"}>
            <Button
              size="sm"
              onClick={onClick}
              className={cn("w-full min-w-0 justify-center", labelled ? "px-2" : "px-0")}
            >
              <Icon size={11} />
              {labelled && <span className="truncate">{label}</span>}
            </Button>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}


/**
 * A preference small enough to keep in the browser: which hosts are folded.
 * Blocked or cleared site data just means the default wins, which is why every
 * access is wrapped rather than assumed.
 */
function useRemembered(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const storageKey = `review-tool:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  });

  return [
    value,
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Private windows and blocked site data: it just does not persist.
      }
    },
  ];
}

function Host({
  connection,
  context,
  active,
}: {
  connection: Connection;
  context: { provider: string; org: string; project: string; repo?: string };
  active?: boolean;
}) {
  const Icon = ICONS[connection.provider];
  // The host of the repo in front of us opens; the other one is reference.
  const [open, setOpen] = useRemembered(`connection:${connection.provider}`, Boolean(active));

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="mb-1 flex w-full items-center gap-1.5 text-left hover:text-foreground"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
        )}
        <Icon size={12} className="shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium">{connection.label}</span>
        {/* Which one the repo in front of us is on, so a machine with both is
            never ambiguous about where a click would land. */}
        {/* Smaller than a badge elsewhere: in the sidebar it sits beside an
            11px label, and at full size it shouted over the host's name. */}
        {active && (
          <StatusBadge tone="on" className="px-1 py-0 text-[9px] leading-[14px]">
            this repo
          </StatusBadge>
        )}
        {/* Folded, the header still answers the two questions the section
            exists for: who is signed in, and whether they can do anything. */}
        {!open && (
          <span className="ml-auto flex min-w-0 items-center gap-1">
            <span className="truncate text-[11px] text-muted-foreground">
              {connection.signedIn
                ? (connection.user?.displayName ?? "signed in")
                : connection.installed
                  ? "not signed in"
                  : `no ${connection.cli}`}
            </span>
            <AccessBadge access={connection.repoAccess} compact />
          </span>
        )}
      </button>

      <dl className={cn("space-y-1 text-[11px]", !open && "hidden")}>
        {active && context.org && <Row label={connection.orgLabel} value={context.org} />}
        {active && connection.projectLabel && context.project && (
          <Row label={connection.projectLabel} value={context.project} />
        )}
        {connection.signedIn ? (
          // The account its CLI token belongs to: it is who every comment, vote
          // and pull request opened from here will be attributed to.
          <Row
            label="Account"
            value={connection.user?.displayName ?? "unknown"}
            title={connection.user?.email}
            icon={UserRound}
            // Signed in is not the same as able: the badge qualifies the account
            // it sits beside, on either host, rather than claiming a row.
            after={<AccessBadge access={connection.repoAccess} compact />}
          />
        ) : (
          <div className="flex items-baseline gap-2 text-muted-foreground">
            <dt className="w-16 shrink-0">Account</dt>
            {/* Not installed and not signed in are different problems, and
                only one of them is fixed by running a login command. */}
            <dd className="min-w-0 truncate" title={connection.error}>
              {connection.installed ? (
                <>
                  not signed in, run <code>{connection.signInHint}</code>
                </>
              ) : (
                <>
                  {/* Installing a CLI does not change the PATH of a process that
                      is already running, so the honest answer names both causes. */}
                  no <code>{connection.cli}</code> on PATH; restart if just installed
                </>
              )}
            </dd>
          </div>
        )}

      </dl>
    </div>
  );
}

/**
 * Signed in, and still unable to touch this repo: a different account, a
 * different tenant, or no access. Two words beside the account, the whole
 * explanation on hover, because the sidebar is narrow and this is rare.
 * Host-agnostic: the provider decides the words, both of them answer the same.
 */
export function AccessBadge({
  access,
  compact,
}: {
  access?: Connection["repoAccess"];
  /** Sidebar size, where it sits against 11px labels. Settings uses full size. */
  compact?: boolean;
}) {
  if (!access || access.ok) return null;
  return (
    <Tooltip
      content={
        <span className="block space-y-1">
          <span className="block">{access.reason}</span>
          {access.hint && <span className="block opacity-80">{access.hint}</span>}
        </span>
      }
    >
      <StatusBadge
        tone="warning"
        icon={Info}
        className={cn("shrink-0", compact && "px-1 py-0 text-[9px] leading-[14px]")}
      >
        {access.permission === "read" ? "read only" : "no access"}
      </StatusBadge>
    </Tooltip>
  );
}

function Row({
  label,
  value,
  title,
  icon: Icon,
  after,
}: {
  label: string;
  value: string;
  title?: string;
  icon?: typeof UserRound;
  /** Sits after the value, for a badge that qualifies it rather than a row of its own. */
  after?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 font-mono">
        {Icon && <Icon size={10} className="shrink-0 text-muted-foreground" />}
        <span className="truncate" title={title ?? value}>
          {value}
        </span>
        {after}
      </dd>
    </div>
  );
}
