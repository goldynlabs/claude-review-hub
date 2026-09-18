import { buildActionPrompt } from "./actions.js";
import { listProfiles } from "./profiles.js";
import { listSessionPrs, setPrProfile } from "../sessions.js";
import { askClaude } from "./oneShot.js";

/**
 * What Auto detect came back with for one pull request. It is a suggestion and
 * nothing more: the reviewer sees every row and corrects it before anything is
 * reviewed, so a wrong guess here costs a click, not a run.
 */
export interface ProfileSuggestion {
  sessionPrId: string;
  prId: number;
  profileId: string | null;
  note: string;
  /** One line explaining the pick, for the reviewer reading the modal. */
  reason: string;
}

/** A model told to answer with JSON only still wraps it in a fence half the time. */
function unfence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Asks a Claude of its own which profile fits each pull request. It runs
 * between the two halves of an Auto detect review, sees only the profiles by
 * name and the pull requests as they were registered, and answers into a modal
 * the reviewer then edits. Nothing it says reaches the agent unaltered.
 */
export async function suggestProfiles(
  sessionId: string,
  /** What the reviewer typed in the confirmation that showed them this prompt. */
  note = "",
  /** Their rewrite of it, sent as written when they opened the editor. */
  edited?: string,
): Promise<ProfileSuggestion[]> {
  const prs = listSessionPrs(sessionId);
  if (!prs.length) return [];

  const text = await askClaude(
    edited?.trim() || buildActionPrompt("profiles.suggest", { sessionId, note }),
    "Answer with the JSON that was asked for and nothing else.",
  );

  const known = new Set(listProfiles().map((profile) => profile.id));
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    // An unreadable answer is not a failure worth stopping for: the modal opens
    // with nothing suggested and the reviewer picks for themselves.
    parsed = [];
  }
  const rows = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];

  return prs.map((pr) => {
    const row = rows.find((item) => Number(item.prId) === pr.prId);
    const suggested = typeof row?.profileId === "string" ? row.profileId : null;
    return {
      sessionPrId: pr.id,
      prId: pr.prId,
      // A profile it invented is no profile at all; the row then needs a note.
      profileId: suggested && known.has(suggested) ? suggested : null,
      note: typeof row?.note === "string" ? row.note.trim() : "",
      reason: typeof row?.reason === "string" ? row.reason.trim() : "",
    };
  });
}

/**
 * The reviewer's final say, which is what the review is actually built from.
 * One of the two has to be there: a pull request with neither a profile nor a
 * note would be asked for with nothing said about it.
 */
export function saveProfileChoices(
  sessionId: string,
  choices: Array<{ sessionPrId: string; profileId: string | null; note: string }>,
): void {
  const prs = listSessionPrs(sessionId);
  const known = new Set(listProfiles().map((profile) => profile.id));
  for (const choice of choices) {
    const pr = prs.find((item) => item.id === choice.sessionPrId);
    if (!pr) throw new Error(`That pull request is not in this session: ${choice.sessionPrId}`);
    const profileId = choice.profileId && known.has(choice.profileId) ? choice.profileId : null;
    const note = (choice.note ?? "").trim();
    if (!profileId && !note) {
      throw new Error(`Pull request ${pr.prId} has neither a profile nor a note, so nothing would be asked of it.`);
    }
    setPrProfile(pr.id, profileId, note);
  }
}
