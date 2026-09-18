import { Info } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import { Checkbox } from "./ui/Checkbox";
import { Tooltip } from "./ui/Tooltip";

let saveQueue: Promise<void> = Promise.resolve();

/**
 * How hard a review looks, as opposed to what it looks for. The profile owns
 * the criteria; these three own the cost, so they are one setting rather than
 * a copy inside every profile. Defined once here and shown wherever a review
 * is about to be started: Settings, the sidebar, and the confirmation.
 */
export function ReviewDepth({ className }: { className?: string }) {
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  if (!settings) return null;

  const set = async (patch: Partial<typeof settings.review>) => {
    saveQueue = saveQueue.catch(() => undefined).then(async () => {
      const current = useStore.getState().settings;
      if (!current) return;
      setSettings(await api.saveSettings({ review: { ...current.review, ...patch } }));
    });
    await saveQueue;
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Checkbox
        label="Review against the project's own rule files"
        checked={settings.review.useProjectRules}
        onCheckedChange={(useProjectRules) => void set({ useProjectRules })}
      />
      <div className="flex items-center gap-1.5">
        <Checkbox
          label="Spawn one agent per dimension"
          checked={settings.review.parallelDimensions}
          onCheckedChange={(parallelDimensions) => void set({ parallelDimensions })}
        />
        <Tooltip
          wide
          content="Each dimension gets its own subagent reading the diff, instead of one reviewer covering them all. More thorough, and several times the tokens, so several times the cost of a run."
        >
          <Info size={13} className="cursor-help text-muted-foreground" />
        </Tooltip>
      </div>
      <div className="flex items-center gap-1.5">
        <Checkbox
          label="Re-check every finding when the review is done"
          checked={settings.review.verifyFindings}
          onCheckedChange={(verifyFindings) => void set({ verifyFindings })}
        />
        <Tooltip
          wide
          content="A second pass spawns an agent per finding to refute it against the code, so confidences are earned and false positives drop out. It is another agent per finding, so it costs more tokens than the review itself."
        >
          <Info size={13} className="cursor-help text-muted-foreground" />
        </Tooltip>
      </div>
    </div>
  );
}
