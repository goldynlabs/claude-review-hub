import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { ProfileSuggestion } from "../lib/types";
import { useConfirm } from "./Confirm";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Select, SelectItem } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

/** What one pull request is to be reviewed against, as the modal holds it. */
interface Choice {
  sessionPrId: string;
  profileId: string;
  note: string;
}

export interface AutoDetectStart {
  sessionId: string;
  /**
   * True while the pull requests still have to be resolved: the review is cut
   * in two and this is the first half. False when the session already holds
   * them, which is Review all, and the picking starts straight away.
   */
  prepare: boolean;
  /** The free text naming the pull requests, for the preparing turn. */
  request: string;
  /** What the reviewer typed in the confirmation they have just answered. */
  note: string;
  /** Their rewrite of that prompt, when they opened the editor. */
  prompt?: string;
}

type Stage =
  | { kind: "idle" }
  | { kind: "waiting"; sessionId: string; afterSeq: number }
  | { kind: "suggesting"; sessionId: string }
  | { kind: "assigning"; sessionId: string; suggestions: ProfileSuggestion[] }
  | { kind: "failed"; message: string };

const AutoDetectContext = createContext<((start: AutoDetectStart) => Promise<void>) | null>(null);

export function useAutoDetect(): (start: AutoDetectStart) => Promise<void> {
  const start = useContext(AutoDetectContext);
  if (!start) throw new Error("useAutoDetect needs an <AutoDetectProvider> above it.");
  return start;
}

/**
 * Auto detect, which is a review in two turns rather than one. The criteria
 * cannot be chosen before the pull requests are known, so the first turn only
 * resolves and registers them; a Claude of its own then says which profile
 * fits each; the reviewer corrects every row in a modal that will not close by
 * accident; and only then is the review itself confirmed and sent.
 *
 * Nothing here runs unless the profile picker is on Auto detect, so every
 * other way of starting a review is the one turn it always was.
 */
export function AutoDetectProvider({ children }: { children: React.ReactNode }) {
  const confirm = useConfirm();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const events = useStore((state) => state.events);
  const openSessionId = useStore((state) => state.sessionId);

  const suggest = useCallback(async (sessionId: string, note: string, prompt?: string) => {
    setStage({ kind: "suggesting", sessionId });
    try {
      const { suggestions } = await api.suggestProfiles(sessionId, note, prompt);
      if (!suggestions.length) {
        setStage({ kind: "failed", message: "No pull requests were registered, so there is nothing to review." });
        return;
      }
      setStage({ kind: "assigning", sessionId, suggestions });
    } catch (error) {
      setStage({ kind: "failed", message: (error as Error).message });
    }
  }, []);

  const start = useCallback<(start: AutoDetectStart) => Promise<void>>(
    async ({ sessionId, prepare, request, note, prompt }) => {
      if (!prepare) return suggest(sessionId, note, prompt);
      // Whatever has already happened in this session is not this turn ending.
      const afterSeq = useStore.getState().events.at(-1)?.seq ?? 0;
      setStage({ kind: "waiting", sessionId, afterSeq });
      try {
        await api.runAction(sessionId, "review.prepare", { request, note, ...(prompt ? { prompt } : {}) });
      } catch (error) {
        setStage({ kind: "failed", message: (error as Error).message });
      }
    },
    [suggest],
  );

  // The preparing turn has no callback: it ends on the session's own stream,
  // like every other turn, and that is what moves this along.
  useEffect(() => {
    if (stage.kind !== "waiting") return;
    const end = events.find(
      (event) =>
        event.seq > stage.afterSeq &&
        (event.type === "run.error" ||
          event.type === "run.stopped" ||
          (event.type === "run.finished" && event.payload?.label === "review.prepare")),
    );
    if (!end) return;
    const ok = end.type === "run.finished" && !end.payload?.isError && !end.payload?.stopped;
    if (ok) void suggest(stage.sessionId, "");
    else setStage({ kind: "idle" });
  }, [events, stage, suggest]);

  // Walking away from the session the flow belongs to ends it; the assignment
  // is still there to be made from Review all whenever they come back.
  useEffect(() => {
    if (stage.kind === "idle" || stage.kind === "failed") return;
    if (stage.sessionId !== openSessionId) setStage({ kind: "idle" });
  }, [openSessionId, stage]);

  const assigned = async (sessionId: string, choices: Choice[]) => {
    await api.savePrProfiles(
      sessionId,
      choices.map((choice) => ({ ...choice, profileId: choice.profileId || null })),
    );
    setStage({ kind: "idle" });
    // The last step is the ordinary one: the whole prompt, in the one
    // confirmation, with the criteria this modal just settled written into it.
    const { ok, note, prompt } = await confirm({
      title: "Review",
      action: "review.auto",
      session: sessionId,
      notePlaceholder: "Anything that applies to all of them.",
    });
    if (!ok) return;
    await api.runAction(sessionId, "review.auto", { note, ...(prompt ? { prompt } : {}) });
  };

  return (
    <AutoDetectContext.Provider value={start}>
      {children}

      {(stage.kind === "waiting" || stage.kind === "suggesting") && (
        <Modal
          open
          disableOutsideClose
          onOpenChange={(open) => !open && setStage({ kind: "idle" })}
          title="Auto detect"
          description={
            stage.kind === "waiting"
              ? "Finding the pull requests first. Which profile each is reviewed against comes next."
              : "Reading the pull requests and picking a profile for each."
          }
        >
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {stage.kind === "waiting" ? "The agent is resolving them." : "A Claude of its own is choosing."}
          </div>
        </Modal>
      )}

      {stage.kind === "failed" && (
        <Modal
          open
          onOpenChange={() => setStage({ kind: "idle" })}
          title="Auto detect stopped"
          footer={<Button onClick={() => setStage({ kind: "idle" })}>Close</Button>}
        >
          <p className="py-2 text-xs text-destructive">{stage.message}</p>
        </Modal>
      )}

      {stage.kind === "assigning" && (
        <AssignDialog
          suggestions={stage.suggestions}
          onCancel={() => setStage({ kind: "idle" })}
          onDone={(choices) => assigned(stage.sessionId, choices)}
        />
      )}
    </AutoDetectContext.Provider>
  );
}

/**
 * The suggestion, made correctable. It does not close by clicking away: what
 * is in here is the whole of what each pull request will be reviewed against,
 * and losing it to a stray click would mean running the first turn again.
 */
function AssignDialog({
  suggestions,
  onCancel,
  onDone,
}: {
  suggestions: ProfileSuggestion[];
  onCancel: () => void;
  onDone: (choices: Choice[]) => Promise<void>;
}) {
  const prs = useStore((state) => state.prs);
  const profiles = useStore((state) => state.profiles);
  const [busy, setBusy] = useState(false);

  const [choices, setChoices] = useState<Choice[]>(() =>
    suggestions.map((suggestion) => {
      // What was settled for this pull request before wins over a fresh guess:
      // a second run of Auto detect is a correction, not a blank page.
      const pr = prs.find((item) => item.id === suggestion.sessionPrId);
      return {
        sessionPrId: suggestion.sessionPrId,
        profileId: pr?.profileId ?? suggestion.profileId ?? "",
        note: pr?.reviewNote ?? suggestion.note,
      };
    }),
  );

  // A pull request with neither would be asked for with nothing said about it.
  const missing = useMemo(
    () => choices.filter((choice) => !choice.profileId && !choice.note.trim()).length,
    [choices],
  );

  const patch = (sessionPrId: string, fields: Partial<Choice>) =>
    setChoices(choices.map((choice) => (choice.sessionPrId === sessionPrId ? { ...choice, ...fields } : choice)));

  return (
    <Modal
      open
      disableOutsideClose
      onOpenChange={(open) => !open && onCancel()}
      title="What each pull request is reviewed against"
      description="Suggested by a Claude of its own. Change anything: a pull request may have no profile, as long as you say what to look at."
      maxWidth="max-w-2xl"
      footer={
        <>
          {missing > 0 && (
            <span className="mr-auto self-center text-[11px] text-muted-foreground">
              {missing} pull request{missing === 1 ? "" : "s"} still need a profile or a note.
            </span>
          )}
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || missing > 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onDone(choices);
              } finally {
                setBusy(false);
              }
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {choices.map((choice) => {
          const pr = prs.find((item) => item.id === choice.sessionPrId);
          const suggestion = suggestions.find((item) => item.sessionPrId === choice.sessionPrId);
          return (
            <div key={choice.sessionPrId} className="space-y-1.5 rounded-md bg-muted p-2">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-medium">#{pr?.prId ?? suggestion?.prId}</span>
                <span className="truncate text-muted-foreground">
                  {pr?.repo}
                  {pr?.title ? ` · ${pr.title}` : ""}
                </span>
              </div>
              {suggestion?.reason && (
                <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles size={11} className="mt-0.5 shrink-0" />
                  <span>{suggestion.reason}</span>
                </div>
              )}
              <Select
                value={choice.profileId}
                placeholder="No profile"
                onValueChange={(profileId) => patch(choice.sessionPrId, { profileId })}
              >
                <SelectItem value="">No profile, review it against the note alone</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </Select>
              <Textarea
                rows={2}
                value={choice.note}
                placeholder={
                  choice.profileId
                    ? "Anything this pull request in particular needs looked at. Optional."
                    : "With no profile this is the whole brief, so say what to look for."
                }
                onChange={(event) => patch(choice.sessionPrId, { note: event.target.value })}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
