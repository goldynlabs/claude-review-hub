import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Ported from project-cc-wf so both tools share one button language.
// Every button is solid: five fills only, no outline style anywhere.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0",
  {
    variants: {
      variant: {
        foreground: "bg-foreground text-background hover:bg-foreground/90",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        muted: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
        // The same tone as muted, only filled on hover: for icon buttons that
        // would otherwise pepper the chrome with grey boxes.
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        success: "bg-success text-success-foreground hover:bg-success/90",
      },
      size: {
        sm: "text-xs px-3 py-1.5 rounded",
        md: "text-sm px-4 py-2 rounded-md",
        lg: "text-base px-5 py-2.5 rounded-md",
        icon: "p-1.5 rounded-md",
      },
    },
    defaultVariants: { variant: "muted", size: "sm" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { buttonVariants };
