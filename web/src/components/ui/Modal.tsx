import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra element placed between the title and the close button. */
  headerAction?: ReactNode;
  maxWidth?: string;
  /** A height class, for dialogs whose box should not resize as you move between tabs. */
  height?: string;
  disableOutsideClose?: boolean;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerAction,
  maxWidth = "max-w-md",
  height,
  disableOutsideClose,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 animate-in fade-in-0" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-card shadow-xl focus:outline-none animate-in fade-in-0 zoom-in-95 ${maxWidth} max-h-[calc(100vh-2rem)] ${height ?? ""}`}
          onInteractOutside={disableOutsideClose ? (event) => event.preventDefault() : undefined}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4">
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">{description}</Dialog.Description>
              )}
            </div>
            <div className="mt-0.5 flex shrink-0 items-center gap-1">
              {headerAction}
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X size={15} />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>

          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 pb-4 pt-3">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
