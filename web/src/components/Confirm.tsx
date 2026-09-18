import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { AUTO_PROFILE_ID, AutoProfileLabel } from "../lib/autoDetect";
import { cn } from "../lib/cn";
import { commentStyleParams, readCommentStyle, TONES, writeCommentStyle } from "../lib/commentStyle";
import { useStore } from "../lib/store";
import { PROMPT_LABEL, PromptView } from "./PromptView";
import { ReviewDepth } from "./ReviewDepth";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Modal } from "./ui/Modal";
import { RadioGroup } from "./ui/Radio";
import { Select, SelectItem } from "./ui/Select";
import { StatusBadge } from "./ui/StatusBadge";
import { Textarea } from "./ui/Textarea";

/**
 * One confirmation for the whole dashboard. Every control that sends something
 * - to the agent, or straight to the host - goes through `useConfirm`, so the
 * question always looks the same and always shows what is about to be sent.
 */
export interface ConfirmRequest {
  title: string;
  description?: string;
  /** Changes the pull request on its host, rather than only asking the agent. */
  writes?: boolean;
  /** The host that pull request is on, so the warning names the right one. */
  host?: string;
  /** The action whose prompt to fetch, so the preview is the real thing. */
  action?: string;
  /**
   * Which session the prompt belongs to. Left out it is the open one, which is
   * what every control inside a session wants. `null` says there is no session
   * yet: the sidebar asks this before creating one, so that cancelling leaves
   * nothing behind.
   */
  session?: string | null;
  params?: Record<string, unknown>;
  /**
   * Lets the profile be picked here, for the controls that start a review: the
   * criteria are half of what is being sent, so they belong beside the prompt
   * rather than only in a dropdown elsewhere. The preview follows the choice.
   */
  profile?: boolean;
  /**
   * The action to preview instead, once the profile picker is on Auto detect.
   * Auto detect does not send this action's prompt at all: it sends the first
   * of its own two turns, and that is what has to be on screen. Offering it
   * also puts Auto detect in the picker, so a control that cannot carry it
   * simply leaves this out.
   */
  autoAction?: string;
  /**
   * Offers how the comment should read, for the controls that write one on the
   * pull request: the tone, and whether the fix may travel with it. The choice
   * is the reviewer's and is remembered, and the preview follows it.
   */
  commentStyle?: boolean;
  /** For work the server does itself: what will be sent, built here instead. */
  preview?: (note: string) => string;
  previewLabel?: string;
  /** Left out for decisions with nothing to say to anyone, like Dismiss. */
  noteLabel?: string | null;
  /**
   * Which parameter the box feeds. The default is the note appended to the
   * prompt; set it to feed the request itself, for a control whose whole
   * input is what the agent is being asked to do.
   */
  noteParam?: string;
  notePlaceholder?: string;
  confirmLabel?: string;
}

export interface ConfirmResult {
  ok: boolean;
  note: string;
  /** Set only when the reviewer rewrote the prompt; sent instead of the built one. */
  prompt?: string;
  /** The profile picked here, when the confirmation offered the choice. */
  profileId?: string;
  /** Anything else the confirmation let the reviewer pick, for the action's params. */
  options?: Record<string, string>;
}

type Ask = (request: ConfirmRequest) => Promise<ConfirmResult>;

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm needs a <ConfirmProvider> above it.");
  return ask;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<{
    request: ConfirmRequest;
    settle: (result: ConfirmResult) => void;
  } | null>(null);
  const pendingRef = useRef<typeof pending>(null);

  const ask = useCallback<Ask>(
    (request) => {
      if (pendingRef.current) return Promise.resolve({ ok: false, note: "" });
      return new Promise<ConfirmResult>((resolve) => {
        const next = { request, settle: resolve };
        pendingRef.current = next;
        setPending(next);
      });
    },
    [],
  );

  const close = (result: ConfirmResult) => {
    pendingRef.current?.settle(result);
    pendingRef.current = null;
    setPending(null);
  };

  useEffect(() => () => {
    pendingRef.current?.settle({ ok: false, note: "" });
    pendingRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={useMemo(() => ask, [ask])}>
      {children}
      {pending && <ConfirmDialog request={pending.request} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: (result: ConfirmResult) => void;
}) {
  const openSessionId = useStore((state) => state.sessionId);
  const profiles = useStore((state) => state.profiles);
  // The depth settings are part of what the prompt says, so the preview has to
  // follow them the way it follows the profile.
  const depth = useStore((state) => state.settings?.review);
  const sessionProfileId = useStore((state) => state.session?.profileId);
  // `null` is a prompt for a session that does not exist yet, and is passed on
  // as it is; `undefined` means the one on screen.
  const sessionId = request.session === undefined ? openSessionId : request.session;
  const [note, setNote] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  // Long values the preview kept as placeholders; each one is on its own hover.
  const [values, setValues] = useState<Record<string, string>>({});
  // What is actually sent, which is what editing has to start from: the reading
  // form above still has `{placeholder}` in it.
  const [full, setFull] = useState("");
  /** The reviewer's rewrite, once they have opened the editor. */
  const [edited, setEdited] = useState<string | null>(null);

  const { params, preview, writes, host } = request;
  const wantsNote = request.noteLabel !== null;

  // What the run would use if nothing were picked here: the session's profile,
  // or whatever the caller already put in the params when there is no session.
  const [profileId, setProfileId] = useState(
    () => String(params?.profileId ?? "") || sessionProfileId || profiles[0]?.id || "default",
  );
  const auto = Boolean(request.autoAction) && profileId === AUTO_PROFILE_ID;
  // Auto detect settles the criteria per pull request in a step of its own, so
  // what this button is about to send is that step, not the review.
  const action = auto ? request.autoAction : request.action;

  const [style, setStyle] = useState(() => readCommentStyle());
  const options = request.commentStyle ? commentStyleParams(style) : {};
  const withProfile = { ...(params ?? {}), ...(request.profile ? { profileId } : {}), ...options };

  const pickStyle = (next: typeof style) => {
    setStyle(next);
    writeCommentStyle(next);
  };

  // Debounced, so the preview follows the note without a request per keystroke.
  // Once the reviewer is editing, it stops following: their words win.
  useEffect(() => {
    if (edited !== null) return;
    if (preview) {
      setPrompt(preview(note));
      setFull(preview(note));
      return;
    }
    if (!action || sessionId === undefined || sessionId === "") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const query = Object.fromEntries(
        Object.entries({ ...withProfile, [request.noteParam ?? "note"]: note })
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
          .map(([key, value]) => [key, String(value)]),
      );
      api
        .actionPreview(sessionId, action, query)
        .then((result) => {
          if (cancelled) return;
          setPrompt(result.prompt);
          setValues(result.values ?? {});
          setFull(result.full ?? result.prompt);
        })
        .catch((error: Error) => !cancelled && setPrompt(`Could not load the prompt: ${error.message}`));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, action, JSON.stringify(withProfile), JSON.stringify(depth), note, preview, request.noteParam, edited]);

  const showsPreview = Boolean(action || preview);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose({ ok: false, note: "" })}
      title={request.title}
      description={
        request.description ??
        (writes
          ? `This changes the pull request${host ? ` on ${host}` : ""}.`
          : "Sent to the agent in this session. Nothing changes on the pull request.")
      }
      maxWidth={showsPreview ? "max-w-2xl" : "max-w-md"}
      footer={
        <>
          <Button onClick={() => onClose({ ok: false, note: "" })}>Cancel</Button>
          <Button
            variant={writes ? "primary" : "primary"}
            disabled={edited !== null ? !edited.trim() : Boolean(request.noteParam) && !note.trim()}
            onClick={() => onClose({
              ok: true,
              note,
              prompt: edited?.trim() || undefined,
              profileId: request.profile ? profileId : undefined,
              options,
            })}
          >
            {request.confirmLabel ?? request.title}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {writes && (
          <div className="flex items-start gap-2 rounded-md bg-severity-warning/10 p-2 text-xs text-severity-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>Everyone on the pull request will see this. The dashboard cannot undo it.</span>
          </div>
        )}

        {request.profile && (
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Profile</div>
              <Select value={profileId} onValueChange={setProfileId}>
                {/* Not a profile, and offered only where the two-step review it
                    needs can actually be run. */}
                {request.autoAction && (
                  <SelectItem value={AUTO_PROFILE_ID}>
                    <AutoProfileLabel />
                  </SelectItem>
                )}
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </Select>
              {auto && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This sends the prompt below. A Claude of its own then suggests a profile for each pull request, and
                  you correct it before the review itself is sent.
                </p>
              )}
            </div>
            {/* The criteria are the profile's; how hard to look is a setting,
                and it belongs beside the profile rather than behind Settings. */}
            <ReviewDepth className="rounded-md bg-muted p-2" />
          </div>
        )}

        {request.commentStyle && (
          <div className="space-y-2 rounded-md bg-muted p-2">
            <Checkbox
              label="Include a suggested change where the fix is clear"
              checked={style.suggestions}
              onCheckedChange={(suggestions) => pickStyle({ ...style, suggestions })}
            />
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Tone</div>
              <RadioGroup
                name="comment-tone"
                value={style.tone}
                onChange={(tone) => pickStyle({ ...style, tone })}
                options={TONES}
              />
            </div>
          </div>
        )}

        {wantsNote && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {request.noteLabel ?? "Anything to add? (optional)"}
            </div>
            <Textarea
              rows={2}
              value={note}
              placeholder={request.notePlaceholder ?? "Keep it short, and mention the migration."}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}

        {showsPreview && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{request.previewLabel ?? PROMPT_LABEL}</span>
              {edited !== null && <StatusBadge tone="warning">edited</StatusBadge>}
              {/* The template is a starting point. Anything a button cannot say,
                  the reviewer says by rewriting what it was going to send. */}
              <button
                type="button"
                onClick={() => setEdited(edited === null ? full : null)}
                className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-normal hover:bg-muted hover:text-foreground"
              >
                {edited === null ? (
                  <>
                    <Pencil size={11} /> Edit
                  </>
                ) : (
                  <>
                    <RotateCcw size={11} /> Undo the edit
                  </>
                )}
              </button>
            </div>
            {edited === null ? (
              // An agent prompt fills this box anyway, so it is held open at
              // its full height: the modal must not jump as the preview lands.
              <div className={cn("max-h-80 overflow-auto rounded-md bg-muted p-2", action && "min-h-80")}>
                <PromptView text={prompt ?? "Loading the prompt…"} details={values} />
              </div>
            ) : (
              <Textarea
                rows={14}
                value={edited}
                className="font-mono text-[11px] leading-relaxed"
                onChange={(event) => setEdited(event.target.value)}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
