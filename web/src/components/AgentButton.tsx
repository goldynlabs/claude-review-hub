import { useState } from "react";
import { api } from "../lib/api";
import { useHostName } from "../lib/providers";
import { useStore } from "../lib/store";
import { useConfirm } from "./Confirm";
import { PROMPT_LABEL, PromptView } from "./PromptView";
import { Button, type ButtonProps } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

/**
 * The prompt an action will send, always from the server. Filling templates in
 * the browser as well would be a second implementation of the same thing, and
 * the two drifted apart the moment one of them learned about notes.
 */
function usePromptPreview(action: string, params: Record<string, unknown>) {
  const sessionId = useStore((state) => state.sessionId);
  const [prompt, setPrompt] = useState<string | null>(null);
  // The long values the prompt left as placeholders, shown on hover instead.
  const [values, setValues] = useState<Record<string, string>>({});

  const load = async () => {
    if (prompt || !sessionId) return;
    try {
      const stringParams = Object.fromEntries(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      );
      const result = await api.actionPreview(sessionId, action, stringParams);
      setPrompt(result.prompt);
      setValues(result.values ?? {});
    } catch (error) {
      setPrompt(`Could not load the prompt: ${(error as Error).message}`);
    }
  };

  return { prompt, values, load, sessionId };
}

/**
 * Shows the exact words a control will send to the agent. Used by every button
 * that puts it to work, and by the ones that only lead there.
 */
export function PromptTooltip({
  action,
  params = {},
  children,
  className,
}: {
  action: string;
  params?: Record<string, unknown>;
  children: React.ReactNode;
  className?: string;
}) {
  const { prompt, values, load } = usePromptPreview(action, params);
  return (
    <Tooltip
      wide
      className={className}
      content={
        <span className="block space-y-1">
          <span className="block text-[10px] uppercase tracking-wide opacity-60">{PROMPT_LABEL}</span>
          <span className="block">
            {/* A hover is a glance, not a read: it says what this does and how much
                more there is, and the confirmation shows the whole thing. */}
            <PromptView text={prompt ?? "Loading the prompt…"} details={values} />
          </span>
          {/* The note lands in the confirmation, not here, and the hover is
              where people look for what a button will send. */}
          <span className="block text-[10px] opacity-60">Clicking opens a confirmation, where a note can be added.</span>
        </span>
      }
    >
      <span onPointerEnter={load}>{children}</span>
    </Tooltip>
  );
}

/** A plain explanation for controls that change the dashboard, not the agent. */
export function LocalTooltip({ children, what }: { children: React.ReactNode; what: string }) {
  return (
    <Tooltip
      content={
        <span className="block space-y-1">
          <span className="block text-[10px] uppercase tracking-wide opacity-60">Dashboard only</span>
          <span className="block">{what}</span>
        </span>
      }
    >
      <span>{children}</span>
    </Tooltip>
  );
}

/**
 * Which host a button's confirmation should name. The params usually point at
 * one pull request; when they do not, a session that holds a single host still
 * answers it, and a session that holds two deliberately answers nothing rather
 * than naming the wrong one.
 */
function useActionHostName(params: Record<string, unknown>): string | undefined {
  const prs = useStore((state) => state.prs);
  const findings = useStore((state) => state.findings);

  const kinds = new Set(prs.map((pr) => pr.provider));
  let provider = kinds.size === 1 ? [...kinds][0] : undefined;

  const prId = params.prId === undefined ? undefined : Number(params.prId);
  if (prId) provider = prs.find((pr) => pr.prId === prId)?.provider ?? provider;

  const findingId = typeof params.findingId === "string" ? params.findingId : undefined;
  if (findingId) {
    const finding = findings.find((item) => item.id === findingId);
    provider = prs.find((pr) => pr.id === finding?.sessionPrId)?.provider ?? provider;
  }

  return useHostName(provider);
}

/**
 * True while a turn is in flight. Every control that would start another one is
 * disabled meanwhile: the server refuses a second turn anyway, and a click that
 * queued one would only dilute the request already running.
 */
export function useAgentBusy(): boolean {
  return useStore((state) => state.session?.status === "running");
}

interface AgentButtonProps extends Omit<ButtonProps, "onClick"> {
  action: string;
  params?: Record<string, unknown>;
  children: React.ReactNode;
  onDone?: () => void;
  /** Placeholder for the box in the confirmation. */
  notePlaceholder?: string;
  noteLabel?: string;
  /**
   * Makes the box the request itself rather than a note beside it, for a
   * button whose whole input is what the agent is being asked to do.
   */
  inputParam?: string;
}

/**
 * Every button that puts the agent to work. Hovering shows the exact prompt it
 * will send: a click here is a message, and the user should never have to guess
 * what they are about to ask for.
 */
export function AgentButton({
  action,
  params = {},
  children,
  onDone,
  notePlaceholder,
  noteLabel,
  inputParam,
  ...buttonProps
}: AgentButtonProps) {
  const { sessionId } = usePromptPreview(action, params);
  const template = useStore((state) => state.actions.find((item) => item.id === action));
  const host = useActionHostName(params);
  const [sending, setSending] = useState(false);
  const busy = useAgentBusy();
  const confirm = useConfirm();

  const run = async () => {
    if (!sessionId) return;
    // Every request gets the same moment to read what is about to be sent and
    // add a note to it. There is no second way of asking anywhere in the UI.
    const { ok, note, prompt } = await confirm({
      title: template?.label ?? "Send to the agent",
      writes: Boolean(template?.writes),
      host,
      action,
      params,
      notePlaceholder: notePlaceholder ?? "Keep it short, and mention the migration.",
      noteLabel,
      noteParam: inputParam,
    });
    if (!ok) return;

    setSending(true);
    try {
      const typed = note ? { [inputParam ?? "note"]: note } : {};
      // A rewritten prompt replaces the built one, rather than adding to it.
      const override = prompt ? { prompt } : {};
      await api.runAction(sessionId, action, { ...params, ...typed, ...override });
      onDone?.();
    } catch (error) {
      // The server refuses a second turn; the button is already disabled by the
      // time anyone reads this, so there is nowhere better to put it.
      console.error(`${action}: ${(error as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <PromptTooltip action={action} params={params}>
      <Button {...buttonProps} disabled={buttonProps.disabled || sending || busy} onClick={run}>
        {children}
      </Button>
    </PromptTooltip>
  );
}
