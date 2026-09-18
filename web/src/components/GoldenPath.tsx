import { FileSearch, ListChecks, MessagesSquare, Plus, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useStore } from "../lib/store";
import { ProfileDialog } from "./ProfileForm";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";

/**
 * What the dashboard shows before there is anything to show: the one path
 * through it, in the order it is walked. Nothing here acts - every control it
 * names is a few pixels away in the sidebar - so it stays a description of the
 * tool rather than a second way of driving it.
 */
export function GoldenPath() {
  const connections = useStore((state) => state.connections);
  const [addingProfile, setAddingProfile] = useState(false);
  // Named from the machine's own hosts, so it never promises a GitHub that is
  // not there. Both, if both answered.
  const hosts = connections.map((connection) => connection.label);
  const hostWords = hosts.length ? hosts.join(" or ") : "the pull request";

  const steps: Array<{
    icon: LucideIcon;
    title: string;
    body: string;
    tag?: string;
    action?: { label: string; onClick: () => void };
  }> = [
    {
      icon: ListChecks,
      title: "Pick a profile, or write one",
      tag: "once",
      action: { label: "New profile", onClick: () => setAddingProfile(true) },
      body:
        "A profile is what a review looks for: its dimensions, the context it should assume, the files to skip. The dropdown at the top of the sidebar picks one; the pencil beside it opens the criteria, and Generate can write them from a sentence about your codebase. A profile is written once and reused by every review after it, so most runs start at step 2.",
    },
    {
      icon: FileSearch,
      title: "Say what to review, then Create",
      body:
        "Pull request numbers, pasted URLs from any organisation, or a sentence describing what you want looked at. Claude resolves each one, builds a worktree of its own, reads the diff, and reports as it goes.",
    },
    {
      icon: ListChecks,
      title: "Read the findings",
      body:
        "Each one names a file and a line and carries the evidence it was made from. Filter by severity or confidence, Challenge one to make Claude argue against it and re-score it, or Dismiss the ones you do not want.",
    },
    {
      icon: Send,
      title: `Post what survives to ${hostWords}`,
      body:
        "Post to PR writes the finding as an inline comment; Resolve closes the thread it opened. Anything that leaves the dashboard is confirmed first, and the confirmation shows the exact prompt before it is sent.",
    },
    {
      icon: MessagesSquare,
      title: "Keep talking to it",
      body:
        "The chat box is the same Claude session, with everything it has already read still in front of it. Ask it to look again, approve the pull request, or answer a reviewer's comment in the Threads tab.",
    },
  ];

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="text-sm font-medium">Start a review in the sidebar</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Five steps, left to right on screen and top to bottom here.
      </p>

      <ol className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">
              {index + 1}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <step.icon size={13} className="text-muted-foreground" />
                {step.title}
                {step.tag && <StatusBadge tone="off">{step.tag}</StatusBadge>}
                {/* The one step with nowhere obvious to start: a profile is
                    made here as readily as in the sidebar. */}
                {step.action && (
                  <Button
                    variant="foreground"
                    className="ml-auto gap-1 px-1.5 py-0.5 text-[10px]"
                    onClick={step.action.onClick}
                  >
                    <Plus size={10} /> {step.action.label}
                  </Button>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {addingProfile && <ProfileDialog onClose={() => setAddingProfile(false)} />}
    </div>
  );
}
