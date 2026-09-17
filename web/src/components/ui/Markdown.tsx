import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";

/**
 * Agents and reviewers both write markdown, so rendering it as plain text loses
 * the structure they meant. Styled here rather than through a typography plugin,
 * to keep the scale of the panels it appears in.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("space-y-2 font-serif leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          h1: ({ children }) => <h1 className="font-sans text-sm font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="font-sans text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="font-sans text-xs font-semibold uppercase tracking-wide">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
          li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 italic text-foreground/80">{children}</blockquote>
          ),
          code: ({ className: codeClass, children }) => {
            // A fenced block arrives with a language class; inline code has none.
            const isBlock = Boolean(codeClass);
            return isBlock ? (
              <code className="block overflow-x-auto font-mono text-xs">{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b px-2 py-1 text-left font-sans font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/50 px-2 py-1 align-top">{children}</td>,
          hr: () => <hr className="border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
