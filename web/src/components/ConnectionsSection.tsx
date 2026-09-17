import { useState } from "react";
import { BookOpen, Building2, CircleAlert, Github, Plug, RefreshCw, Settings, UserRound } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import type { Connection, ProviderKind } from "../lib/types";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";
import { Tooltip } from "./ui/Tooltip";

const ICONS: Record<ProviderKind, typeof Building2> = { azure: Building2, github: Github };

/**
 * Connection status, always visible: which hosts this machine can reach, who
 * each one is signed in as, and which of them the repo being reviewed lives on.
 * Nothing here is typed in by hand.
 */
export function ConnectionsSection({
  collapsed,
  onOpenSettings,
  onOpenInspect,
}: {
  collapsed?: boolean;
  onOpenSettings: () => void;
  onOpenInspect: () => void;
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

        {!active && !others.length && (
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <CircleAlert size={12} className="mt-0.5 shrink-0 text-destructive" />
            <span>
              Neither the <code>az</code> nor the <code>gh</code> CLI is installed, so nothing can be reviewed yet.
            </span>
          </div>
        )}

        {/* Both CLIs there but the remote named neither host: the PR itself has
            to say which one is meant, and it is remembered afterwards. */}
        {!active && others.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            This repo's origin remote is on neither host. Paste a full pull request URL and the host in it is
            remembered.
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" onClick={onOpenSettings} className="flex-1 justify-center">
          <Settings size={11} /> Settings
        </Button>
        {/* The whole contract: actions, tools, prompts, permission rules. */}
        <Button size="sm" onClick={onOpenInspect} className="flex-1 justify-center">
          <BookOpen size={11} /> How it works
        </Button>
      </div>
    </section>
  );
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
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon size={12} className="text-muted-foreground" />
        <span className="text-[11px] font-medium">{connection.label}</span>
        {/* Which one the repo in front of us is on, so a machine with both is
            never ambiguous about where a click would land. */}
        {active && <StatusBadge tone="on">this repo</StatusBadge>}
      </div>

      <dl className="space-y-1 text-[11px]">
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
                  the <code>{connection.cli}</code> CLI is not installed
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  title,
  icon: Icon,
}: {
  label: string;
  value: string;
  title?: string;
  icon?: typeof UserRound;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 font-mono">
        {Icon && <Icon size={10} className="shrink-0 text-muted-foreground" />}
        <span className="truncate" title={title ?? value}>
          {value}
        </span>
      </dd>
    </div>
  );
}
