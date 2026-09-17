import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface TooltipProps {
  content: ReactNode | null;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Merge the trigger onto the child instead of wrapping it in a span. */
  asChild?: boolean;
  /**
   * Classes for the wrapper span. A truncating child needs `min-w-0` here, or
   * the wrapper keeps its natural width and the text never truncates.
   */
  className?: string;
  /** Widen the bubble for long paths and command arguments. */
  wide?: boolean;
}

export function Tooltip({ content, children, side = "top", asChild = false, className, wide }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>
          {/* The span keeps hover alive over disabled buttons. */}
          {asChild ? (
            (children as React.ReactElement)
          ) : (
            <span className={cn("inline-flex", className)}>{children}</span>
          )}
        </T.Trigger>
        <T.Portal>
          <T.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[100] rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md",
              "animate-in fade-in-0 zoom-in-95 dark:bg-secondary dark:text-foreground",
              wide ? "max-w-md" : "max-w-xs",
            )}
          >
            {content}
            <T.Arrow className="fill-foreground dark:fill-secondary" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
