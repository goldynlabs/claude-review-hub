import { Info, Sparkles } from "lucide-react";
import { Tooltip } from "../components/ui/Tooltip";

/**
 * Not a profile, and not in the profile list the server serves: the option
 * that asks a Claude of its own which profile each pull request should be
 * reviewed against. It travels where a profile id goes - the session's
 * `profileId`, the picker in the sidebar and in the confirmation - so its id
 * has a shape no saved profile can take.
 */
export const AUTO_PROFILE_ID = "@auto";

export const AUTO_PROFILE_NAME = "Auto detect";

export function isAutoProfile(id: string | null | undefined): boolean {
  return id === AUTO_PROFILE_ID;
}

/**
 * How Auto detect reads in the profile picker. It is the one option in there
 * that does not start the review on the spot, so it says so where it is
 * chosen rather than only in the confirmation that follows.
 */
export function AutoProfileLabel() {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Sparkles size={11} className="shrink-0 text-muted-foreground" />
      <span className="shrink-0">{AUTO_PROFILE_NAME}</span>
      {/* The trigger draws this too, and the sidebar's is narrow, so the aside
          gives way before the name does. */}
      <span className="truncate text-[9px] text-muted-foreground">you confirm each pick</span>
      <Tooltip
        wide
        content="The pull requests are found first, then you settle a profile and a note for each one."
      >
        <Info size={10} className="shrink-0 cursor-help text-muted-foreground" />
      </Tooltip>
    </span>
  );
}
