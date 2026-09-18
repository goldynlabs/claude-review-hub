/**
 * How a finding should read once it is a comment on the pull request. The
 * choice belongs to the reviewer rather than to the profile: the same finding
 * goes out differently depending on who is going to read it, so it is picked
 * in the confirmation and remembered for the next one.
 *
 * The labels here are the ones on the radio; the sentences the agent actually
 * receives live with the templates, in `server/src/review/actions.ts`, so there
 * is still one definition of the prompt.
 */
export interface CommentStyle {
  tone: string;
  /** Whether the comment may carry the corrected code, ready to apply. */
  suggestions: boolean;
}

export const TONES: { id: string; label: string; hint: string }[] = [
  { id: "neutral", label: "Neutral", hint: "States the defect and why, nothing else." },
  { id: "friendly", label: "Friendly", hint: "Warm and collaborative, never sharp." },
  { id: "direct", label: "Direct", hint: "As few words as the point takes." },
  { id: "mentoring", label: "Mentoring", hint: "Explains the principle behind it." },
  { id: "formal", label: "Formal", hint: "Impersonal, for a written review record." },
];

const KEY = "review-tool:comment-style";

export const DEFAULT_COMMENT_STYLE: CommentStyle = { tone: "neutral", suggestions: false };

export function readCommentStyle(): CommentStyle {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CommentStyle> | null;
    if (!stored) return DEFAULT_COMMENT_STYLE;
    return {
      tone: TONES.some((item) => item.id === stored.tone) ? stored.tone! : DEFAULT_COMMENT_STYLE.tone,
      suggestions: typeof stored.suggestions === "boolean" ? stored.suggestions : DEFAULT_COMMENT_STYLE.suggestions,
    };
  } catch {
    // Private windows and blocked site data: the choice just does not persist.
    return DEFAULT_COMMENT_STYLE;
  }
}

export function writeCommentStyle(style: CommentStyle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(style));
  } catch {
    // As above: the modal still works, it only forgets.
  }
}

/** What travels to the server, as the strings a prompt preview query takes. */
export function commentStyleParams(style: CommentStyle): Record<string, string> {
  return { tone: style.tone, suggestions: style.suggestions ? "yes" : "no" };
}
