import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn";

/** Icon-only copy button, self-contained so it can sit inside a larger
 * clickable row without triggering that row's own click. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; nothing more we can do without a text field to select.
    }
  };

  return (
    <button
      onClick={copy}
      title={`Copy: ${text}`}
      className={cn("shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground", className)}
    >
      {copied ? <Check size={11} className="text-severity-suggestion" /> : <Copy size={11} />}
    </button>
  );
}

export function CopyId({ id, copyText, className }: { id: string | number; copyText: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">ID:</span>
      <span className="font-mono">{id}</span>
      <CopyButton text={copyText} />
    </span>
  );
}
