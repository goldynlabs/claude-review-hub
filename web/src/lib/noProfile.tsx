import { CircleSlash, Info } from "lucide-react";
import { Tooltip } from "../components/ui/Tooltip";

/**
 * Not a profile either, and not in the list the server serves: no criteria at
 * all. What the reviewer types is the whole brief, so the actions it sends are
 * the criteria-free twins of the review prompts. It travels where a profile id
 * goes, so its id has a shape no saved profile can take.
 */
export const NO_PROFILE_ID = "@none";

export const NO_PROFILE_NAME = "No profile";

export function isNoProfile(id: string | null | undefined): boolean {
  return id === NO_PROFILE_ID;
}

/**
 * How it reads in the profile picker. It is the one option that sends nothing
 * of its own, so it says where the criteria then come from.
 */
export function NoProfileLabel() {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <CircleSlash size={11} className="shrink-0 text-muted-foreground" />
      <span className="shrink-0">{NO_PROFILE_NAME}</span>
      <span className="truncate text-[9px] text-muted-foreground">you type what to review</span>
      <Tooltip
        wide
        content="No dimensions, no standing context and no severity floor. What you write in the box is the whole brief, so it is required."
      >
        <Info size={10} className="shrink-0 cursor-help text-muted-foreground" />
      </Tooltip>
    </span>
  );
}
