import { useState } from "react";
import { MessageCircleQuestion, Send, SkipForward } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import type { AskedQuestion, QuestionRequest } from "../lib/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

/** The free-text row every question ends with, which the tool itself does not offer. */
const OTHER = "\u0000other";

/** What one question is answered with while the card is still open. */
interface Answer {
  /** Option labels, or OTHER. More than one only when the question allows it. */
  picked: string[];
  other: string;
}

function blank(): Answer {
  return { picked: [], other: "" };
}

/** What travels to the agent: the labels as they were written, or their words. */
function valueOf(answer: Answer): string {
  const typed = answer.other.trim();
  const labels = answer.picked.filter((label) => label !== OTHER);
  if (answer.picked.includes(OTHER) && typed) return [...labels, typed].join(", ");
  return labels.join(", ");
}

/**
 * The agent asking the reviewer something. Claude Code draws `AskUserQuestion`
 * as a picker, and through the SDK the call lands in the dashboard instead, so
 * it is drawn here rather than left as a line of JSON nobody can answer.
 *
 * Not a confirmation: nothing is being sent anywhere by opening it. The turn is
 * parked on this card until it is answered or skipped, which is why both are
 * one click.
 */
export function QuestionCard({ request }: { request: QuestionRequest }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(request.questions.map((question) => [question.question, blank()])),
  );
  const [sending, setSending] = useState(false);

  const set = (question: string, patch: Partial<Answer>) =>
    setAnswers((current) => ({ ...current, [question]: { ...current[question], ...patch } }));

  const pick = (question: AskedQuestion, label: string) => {
    const current = answers[question.question] ?? blank();
    if (!question.multiSelect) {
      set(question.question, { picked: [label] });
      return;
    }
    const picked = current.picked.includes(label)
      ? current.picked.filter((item) => item !== label)
      : [...current.picked, label];
    set(question.question, { picked });
  };

  // Every question wants an answer: half of them would leave the agent
  // guessing at the rest, which is what it asked in order not to do.
  const complete = request.questions.every((question) => valueOf(answers[question.question] ?? blank()));

  const send = async () => {
    setSending(true);
    try {
      await api.answerQuestions(
        request.requestId,
        Object.fromEntries(
          request.questions.map((question) => [question.question, valueOf(answers[question.question] ?? blank())]),
        ),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <MessageCircleQuestion size={13} className="text-primary" />
        Claude is asking
      </div>

      <div className="space-y-3">
        {request.questions.map((question) => {
          const answer = answers[question.question] ?? blank();
          const chosen = question.options.find((option) => answer.picked.includes(option.label));
          return (
            <div key={question.question}>
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                {question.header && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {question.header}
                  </span>
                )}
                <span className="text-sm">{question.question}</span>
                {question.multiSelect && <span className="text-[10px] text-muted-foreground">pick any</span>}
              </div>

              <div className="space-y-1">
                {question.options.map((option) => (
                  <label
                    key={option.label}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                      answer.picked.includes(option.label) && "bg-muted",
                    )}
                  >
                    <input
                      type={question.multiSelect ? "checkbox" : "radio"}
                      name={`q-${request.requestId}-${question.header}`}
                      checked={answer.picked.includes(option.label)}
                      onChange={() => pick(question, option.label)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{option.label}</span>
                      {option.description && (
                        <span className="block text-[11px] text-muted-foreground">{option.description}</span>
                      )}
                    </span>
                  </label>
                ))}

                {/* The tool says not to offer one, because the surface drawing
                    it is expected to. This is that surface. */}
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                    answer.picked.includes(OTHER) && "bg-muted",
                  )}
                >
                  <input
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`q-${request.requestId}-${question.header}`}
                    checked={answer.picked.includes(OTHER)}
                    onChange={() => pick(question, OTHER)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">Something else</span>
                    <Input
                      value={answer.other}
                      placeholder="In your own words"
                      onFocus={() => !answer.picked.includes(OTHER) && pick(question, OTHER)}
                      onChange={(event) => set(question.question, { other: event.target.value })}
                      className="mt-1"
                    />
                  </span>
                </label>
              </div>

              {/* A mockup or a snippet the option came with: it is the whole
                  reason that option is easier to judge than its label. */}
              {chosen?.preview && (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                  {chosen.preview}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={!complete || sending} onClick={send}>
          <Send size={12} /> Answer
        </Button>
        {/* Parking the turn for ever is worse than saying nothing: skipping
            tells the agent to carry on with its own judgement. */}
        <Button disabled={sending} onClick={() => void api.skipQuestions(request.requestId)}>
          <SkipForward size={12} /> Let Claude decide
        </Button>
      </div>
    </div>
  );
}
