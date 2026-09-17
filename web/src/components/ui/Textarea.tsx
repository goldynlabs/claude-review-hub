import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  size?: "sm" | "md";
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size = "sm", ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-y rounded border bg-transparent font-serif leading-relaxed",
        "focus:outline-none focus:ring-1 focus:ring-ring",
        "placeholder:text-muted-foreground disabled:opacity-50",
        size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
