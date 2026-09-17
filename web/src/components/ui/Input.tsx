import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "md";
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "sm", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded border bg-transparent font-sans",
        "focus:outline-none focus:ring-1 focus:ring-ring",
        "placeholder:text-muted-foreground disabled:opacity-50",
        size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
