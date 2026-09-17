import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

// Radix Select treats "" as "no value", so it is mapped to a sentinel internally.
const EMPTY = "__empty__";
const toInternal = (value: string) => (value === "" ? EMPTY : value);
const toExternal = (value: string) => (value === EMPTY ? "" : value);

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Select({
  value,
  onValueChange,
  placeholder,
  size = "sm",
  disabled,
  className,
  children,
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={toInternal(value)} onValueChange={(next) => onValueChange(toExternal(next))} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          "flex w-full select-none items-center justify-between rounded border bg-transparent font-sans",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[placeholder]:text-muted-foreground/60",
          size === "sm" ? "gap-1 px-2 py-1.5 text-xs" : "gap-2 px-3 py-2 text-sm",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className={cn("shrink-0 text-muted-foreground", size === "sm" ? "h-3 w-3" : "h-4 w-4")} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-lg border bg-card shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export const SelectItem = forwardRef<HTMLDivElement, { value: string; children: React.ReactNode; className?: string }>(
  ({ value, children, className }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      value={toInternal(value)}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded",
        "px-2 py-1.5 pr-7 text-xs outline-none",
        "focus:bg-muted focus:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
        <Check className="h-3 w-3 text-foreground" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = "SelectItem";
