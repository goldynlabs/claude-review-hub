import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Every "there is nothing here" state, written once. `card` fills an empty
 * panel, `inline` is the one-liner used inside a list that already has a frame.
 */
export function Empty({
  icon: Icon,
  title,
  hint,
  variant = "card",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  variant?: "card" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return <div className={cn("px-2 py-3 text-xs text-muted-foreground", className)}>{title}</div>;
  }

  return (
    <div className={cn("card flex flex-col items-center gap-1.5 p-8 text-center", className)}>
      {Icon && <Icon size={20} className="text-muted-foreground/60" />}
      <div className="text-sm text-muted-foreground">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
