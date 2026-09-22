import { cn } from "../../lib/cn";

/**
 * The filter row of a tab. It rides the top of the scrolling panel, and on the
 * way down it slides out of the way so the list has the height, coming back as
 * soon as the scroll turns round. Findings and threads both have such a row, so
 * the behaviour is defined once here rather than copied per tab.
 *
 * The negative margins are the panel's own padding: the row has to reach the
 * edges, or what scrolls past would show beside it.
 */
export function StickyBar({
  hidden,
  className,
  children,
}: {
  hidden: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky -top-3 z-10 -mx-3 -mt-3 flex flex-wrap items-center gap-2 bg-background px-3 pb-2 pt-3",
        "transition-transform duration-200",
        hidden && "-translate-y-full",
        className,
      )}
    >
      {children}
    </div>
  );
}
