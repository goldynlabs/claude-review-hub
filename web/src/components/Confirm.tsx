import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { PROMPT_LABEL, PromptView } from "./PromptView";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
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
  params?: Record<string, unknown>;
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

  const ask = useCallback<Ask>(
    (request) => new Promise<ConfirmResult>((resolve) => setPending({ request, settle: resolve })),
    [],
  );

  const close = (result: ConfirmResult) => {
    pending?.settle(result);
    setPending(null);
  };

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
  const sessionId = useStore((state) => state.sessionId);
  const [note, setNote] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  // Long values the preview kept as placeholders; each one is on its own hover.
  const [values, setValues] = useState<Record<string, string>>({});
  // What is actually sent, which is what editing has to start from: the reading
  // form above still has `{placeholder}` in it.
  const [full, setFull] = useState("");
  /** The reviewer's rewrite, once they have opened the editor. */
  const [edited, setEdited] = useState<string | null>(null);

  const { action, params, preview, writes, host } = request;
  const wantsNote = request.noteLabel !== null;

  // Debounced, so the preview follows the note without a request per keystroke.
  // Once the reviewer is editing, it stops following: their words win.
  useEffect(() => {
    if (edited !== null) return;
    if (preview) {
      setPrompt(preview(note));
      setFull(preview(note));
      return;
    }
    if (!action || !sessionId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const query = Object.fromEntries(
        Object.entries({ ...(params ?? {}), [request.noteParam ?? "note"]: note })
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
  }, [sessionId, action, JSON.stringify(params), note, preview, request.noteParam, edited]);

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
            onClick={() => onClose({ ok: true, note, prompt: edited?.trim() || undefined })}
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
              <div className="max-h-80 overflow-auto rounded-md bg-muted p-2">
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
