import { Info } from "lucide-react";
import { Tooltip } from "./ui/Tooltip";

/**
 * One rendering of a prompt, used everywhere a prompt is shown: the hover on a
 * button, the confirmation before it is sent, and the Actions tab of "How this
 * tool works". Three renderings is how they drifted apart before.
 *
 * `{placeholder}` is marked up, and explained on hover where an explanation
 * exists. What is shown is the display form of the prompt, which keeps the long
 * stored values as their placeholder rather than pasting them in; the agent
 * still receives them in full.
 */
export function PromptView({
  text,
  details = {},
  className = "",
}: {
  text: string;
  details?: Record<string, string>;
  className?: string;
}) {
  return (
    <pre className={`overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${className}`}>
      {text.split(/(\{\w+\}|_[^_\n]+_)/g).map((part, index) => {
        if (/^_[^_\n]+_$/.test(part)) {
          return (
            <em key={index} className="text-muted-foreground">
              {part.slice(1, -1)}
            </em>
          );
        }
        if (!/^\{\w+\}$/.test(part)) return <span key={index}>{part}</span>;

        const detail = details[part.slice(1, -1)];
        const chip = (
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 align-baseline">
            {part}
            {detail && <Info size={10} className="opacity-60" />}
          </span>
        );
        if (!detail) return <span key={index}>{chip}</span>;
        return (
          <Tooltip
            key={index}
            wide
            content={<span className="block whitespace-pre-wrap font-mono text-[11px]">{detail}</span>}
          >
            {chip}
          </Tooltip>
        );
      })}
    </pre>
  );
}

/** The one label for this block, so the three surfaces agree on the words too. */
export const PROMPT_LABEL = "Sent to the agent";
