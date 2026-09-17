import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

interface CheckboxProps {
  id?: string;
  label?: React.ReactNode;
  ariaLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({ id, label, ariaLabel, checked, onCheckedChange, className }: CheckboxProps) {
  const checkboxId = id ?? (label ? `cb-${String(label).toLowerCase().replace(/\s+/g, "-")}` : undefined);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <CheckboxPrimitive.Root
        id={checkboxId}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={ariaLabel}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed"
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Check className="h-3 w-3 text-primary" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && (
        <label htmlFor={checkboxId} className="cursor-pointer select-none text-xs">
          {label}
        </label>
      )}
    </div>
  );
}
