import { useState } from "react";
import { ChevronRight, FolderOpen, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { AUTO_PROFILE_ID, AutoProfileLabel, isAutoProfile } from "../lib/autoDetect";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import { useAutoDetect } from "./AutoProfiles";
import { useConfirm } from "./Confirm";
import { ReviewDepth } from "./ReviewDepth";
import type { Session } from "../lib/types";
import { ConnectionsSection } from "./ConnectionsSection";
import { ProfileDialog } from "./ProfileForm";
import { Logo } from "./Logo";
import { Button } from "./ui/Button";
import { Empty } from "./ui/Empty";
import { Select, SelectItem } from "./ui/Select";
import { Textarea } from "./ui/Textarea";
import { Tooltip } from "./ui/Tooltip";

interface SidebarProps {
  /** Width in pixels while expanded; owned by the layout, which persists it. */
  width: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
  /** Opens the same dialog straight at this profile, for the pencil beside it. */
  onEditProfile: (profileId: string) => void;
  onOpenInspect: () => void;
  onOpenAnalytics: () => void;
}

/** The profile picked for the next review outlives the tab it was picked in. */
const PROFILE_KEY = "review-tool:profile";

/** The newest Claude session of a review, whichever run produced it. */
function resumeId(session: Session): string | null {
  return session.lastClaudeSessionId ?? session.claudeSessionId;
}

/**
 * When the session was started, always in full. Formatted by hand rather than
 * by locale, so it never comes out as an ambiguous month/day order.
 */
function createdLabel(createdAt: string): string {
  const at = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())} ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}

export function Sidebar({
  width,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  onEditProfile,
  onOpenInspect,
  onOpenAnalytics,
}: SidebarProps) {
  const { sessions, sessionId, profiles, openSession, refreshSessions, removeSession, settings, version, projectRoot } =
    useStore();
  // Expanded by default: starting a review is what the sidebar is for.
  const [creating, setCreating] = useState(true);
  const [profileId, setProfileId] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) ?? "default";
    } catch {
      return "default";
    }
  });
  const [prInput, setPrInput] = useState("");
  const [addingProfile, setAddingProfile] = useState(false);
  // Shut by default: the three switches inside are a decision about cost, and
  // most runs are started without thinking about them.
  const [advanced, setAdvanced] = useState(false);
  const confirm = useConfirm();
  const startAuto = useAutoDetect();
  // Settings can delete the profile picked here, so the selection is derived:
  // what was picked while it still exists, the first one otherwise.
  const activeProfileId = isAutoProfile(profileId) || profiles.some((profile) => profile.id === profileId)
    ? profileId
    : (profiles[0]?.id ?? "default");
  const auto = isAutoProfile(activeProfileId);

  const pickProfile = (id: string) => {
    setProfileId(id);
    try {
      localStorage.setItem(PROFILE_KEY, id);
    } catch {
      // Private windows and blocked site data: the choice just does not persist.
    }
  };

  /** Deleting a session takes its findings and its log with it, so it asks. */
  const remove = async (session: Session) => {
    const { ok } = await confirm({
      title: "Delete this session",
      description: `"${session.title}", with its findings, its log and the worktrees it built, unless another session is reviewing the same pull request. The pull request itself is untouched.`,
      noteLabel: null,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await removeSession(session.id);
    } catch (error) {
      // The server refuses while a turn is working in the worktree; the button
      // is disabled by then, so there is nowhere better to put it.
      console.error(`delete session: ${(error as Error).message}`);
    }
  };

  // No name field: the session is named after the PRs it ends up holding.
  const create = async () => {
    const request = prInput.trim();
    if (!request) return;

    // Nothing exists yet. Creating the session sends nothing by itself, but it
    // is the review that is being started here, so the prompt is shown first
    // and only an answer of yes creates anything: cancel and there is no empty
    // session in the list, and the box still holds what was typed.
    const { ok, note, prompt } = await confirm({
      title: "Start the review",
      action: "review",
      // Auto detect turns this into the first of two turns, and the prompt on
      // screen has to be the one that is actually sent.
      autoAction: "review.prepare",
      session: null,
      params: { request, profileId: activeProfileId },
      notePlaceholder: "Focus on the migration, and ignore the generated files.",
    });
    if (!ok) return;

    const session = await api.createSession({ profileId: activeProfileId });
    await refreshSessions();
    // Open first, then ask for the PRs: attaching runs in the background and its
    // progress arrives on the session stream this call subscribes to.
    await openSession(session.id);
    setPrInput("");
    if (auto) {
      await startAuto({ sessionId: session.id, prepare: true, request, note: "", prompt });
      return;
    }
    // A rewritten prompt goes through the action endpoint, which accepts one.
    if (prompt) await api.runAction(session.id, "review", { request, note, prompt });
    else await api.review(session.id, request, note);
  };

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r py-2">
        <Tooltip content="Expand sidebar" side="right">
          <Button variant="ghost" size="icon" onClick={onToggleCollapse}>
            <PanelLeftOpen size={15} />
          </Button>
        </Tooltip>

        <Tooltip content="New review session" side="right">
          <Button
            variant="ghost"
            size="icon"
            className="mt-1"
            onClick={() => {
              onToggleCollapse();
              setCreating(true);
            }}
          >
            <Plus size={15} />
          </Button>
        </Tooltip>

        <div className="mt-2 flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {sessions.map((session) => (
            <Tooltip key={session.id} content={session.title} side="right">
              <button
                onClick={() => openSession(session.id)}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] transition-colors hover:bg-muted",
                  sessionId === session.id && "bg-muted font-medium",
                )}
              >
                {session.status === "running" ? (
                  <span className="h-1.5 w-1.5 animate-status-pulse rounded-full bg-primary" />
                ) : (
                  // Initials of the PR title: the most that fits at this width.
                  session.title.trim().slice(0, 2).toUpperCase()
                )}
              </button>
            </Tooltip>
          ))}
        </div>

        <ConnectionsSection
          collapsed
          onOpenSettings={onOpenSettings}
          onOpenInspect={onOpenInspect}
          onOpenAnalytics={onOpenAnalytics}
        />
      </aside>
    );
  }

  return (
    <aside className="flex shrink-0 flex-col border-r" style={{ width }}>
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Logo size={18} className="shrink-0" />
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <div className="truncate text-sm font-medium">Claude Review Hub</div>
            {/* What this build actually is, from the server's own package.json. */}
            {version && <span className="shrink-0 text-[10px] text-muted-foreground">v{version}</span>}
          </div>
          <Tooltip content="Collapse sidebar">
            <Button variant="ghost" size="icon" onClick={onToggleCollapse}>
              <PanelLeftClose size={15} />
            </Button>
          </Tooltip>
        </div>

        {/* The checkout every review runs against: the folder the tool was
            started in, which decides the remote, the host and the worktrees. */}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FolderOpen size={11} className="shrink-0" />
          <span className="min-w-0 truncate font-mono text-foreground" title={projectRoot}>
            {projectRoot}
          </span>
        </div>
      </div>

      <div className="border-b p-2">
        {!creating ? (
          <Button variant="primary" className="w-full" onClick={() => setCreating(true)}>
            <Plus size={13} /> New review session
          </Button>
        ) : (
          <div>
            <div className="text-[11px] text-muted-foreground">Profile</div>
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Select value={activeProfileId} onValueChange={pickProfile}>
                  {/* Not a profile: it asks a Claude of its own which profile
                      fits each pull request, and you correct the answer. */}
                  <SelectItem value={AUTO_PROFILE_ID}>
                    <AutoProfileLabel />
                  </SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <Tooltip content={auto ? "Auto detect is not a profile, so there is nothing to edit" : "Edit this profile"}>
                <Button variant="ghost" size="icon" disabled={auto} onClick={() => onEditProfile(activeProfileId)}>
                  <Pencil size={13} />
                </Button>
              </Tooltip>
              <Tooltip content="New profile">
                <Button variant="ghost" size="icon" onClick={() => setAddingProfile(true)}>
                  <Plus size={13} />
                </Button>
              </Tooltip>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">PRs / description / request</div>
            {/* Free text on purpose: ids, URLs, or a sentence about what to look at. */}
            <Textarea
              rows={3}
              placeholder={"96632 96633\nor paste PR URLs (any organisation), or describe what to review"}
              value={prInput}
              onChange={(event) => setPrInput(event.target.value)}
            />
            {/* How hard the review looks, as opposed to what it looks for. A
                setting, not the profile's, and the same one Settings shows. */}
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              className="mt-1.5 flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight size={12} className={cn("transition-transform", advanced && "rotate-90")} />
              Advanced
            </button>
            {advanced && <ReviewDepth className="mt-1 rounded-md bg-muted p-2" />}

            <div className="mt-1.5 flex gap-2">
              <Button variant="primary" className="flex-1" disabled={!prInput.trim()} onClick={create}>
                Create
              </Button>
              <Button onClick={() => setCreating(false)}>Hide</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "group relative mb-1 rounded-md transition-colors hover:bg-muted",
              sessionId === session.id && "bg-muted",
            )}
          >
            <button onClick={() => openSession(session.id)} className="w-full px-2 py-2 text-left">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    session.status === "running" ? "animate-status-pulse bg-primary" : "bg-muted-foreground",
                  )}
                />
                {/* Room on the right so a long name never runs under the actions. */}
                <span className="truncate pr-12 text-sm">{session.title}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-3.5 text-[11px] text-muted-foreground">
                <span className="whitespace-nowrap">{createdLabel(session.createdAt)}</span>
                {settings?.showCost && session.costUsd > 0 && <span>${session.costUsd.toFixed(2)}</span>}
              </div>
              {/* The Claude session behind this review, for `claude --resume`. */}
              {resumeId(session) && (
                <div
                  className="truncate pl-3.5 font-mono text-[10px] text-muted-foreground/70"
                  title={`claude --resume ${resumeId(session)}`}
                >
                  {resumeId(session)}
                </div>
              )}
            </button>

            <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                title={
                  session.status === "running"
                    ? "The agent is still working in this session's worktree"
                    : "Delete session"
                }
                disabled={session.status === "running"}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove(session)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        ))}
        {!sessions.length && (
          <Empty variant="inline" title="No sessions yet." className="py-6 text-center" />
        )}
      </div>

      <ConnectionsSection
        width={width}
        onOpenSettings={onOpenSettings}
        onOpenInspect={onOpenInspect}
        onOpenAnalytics={onOpenAnalytics}
      />

      {/* Created here rather than in Settings, and picked straight away: the
          reason to make one is the session about to be started. */}
      {addingProfile && (
        <ProfileDialog onClose={() => setAddingProfile(false)} onSaved={(profile) => pickProfile(profile.id)} />
      )}
    </aside>
  );
}
