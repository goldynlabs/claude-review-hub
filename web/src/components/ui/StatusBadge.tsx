import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

type StatusTone = "on" | "off" | "critical" | "warning" | "suggestion" | "success";

// Solid fills only, no outline badges and no blue "info" tone: a neutral badge
// is the contrast colour, a severity badge is its own colour filled in.
const toneClass: Record<StatusTone, string> = {
  on: "bg-foreground text-background",
  off: "bg-muted text-muted-foreground",
  critical: "bg-severity-critical text-primary-foreground",
  warning: "bg-severity-warning text-background",
  suggestion: "bg-severity-suggestion text-background",
  success: "bg-success text-success-foreground",
};

export function StatusBadge({
  tone = "on",
  icon: Icon,
  children,
  className,
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        toneClass[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {children}
    </span>
  );
}
