import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";

/** One collapsible block; long prose and prompts stay out of the way until asked for. */
export function Accordion({
  title,
  subtitle,
  badge,
  mono,
  defaultOpen,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  mono?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-md bg-muted/30">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        <ChevronRight size={13} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-xs font-medium", mono && "font-mono")}>{title}</span>
            {badge}
          </span>
          {subtitle && <span className="block text-[11px] text-muted-foreground">{subtitle}</span>}
        </span>
      </button>
      {open && <div className="bg-muted/20 px-3 py-2">{children}</div>}
    </div>
  );
}
