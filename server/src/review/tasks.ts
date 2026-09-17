import { runSessionAgent } from "../agent.js";
import { getSettings } from "../config.js";
import { getSession } from "../sessions.js";
import { emit } from "../events.js";
import { sessionSystemPrompt } from "./prompt.js";

/**
 * Anything typed in the chat box, in the same session as the review.
 *
 * `bare` is the session started by typing rather than by reviewing: nothing is
 * appended to the prompt and nothing is said about the dashboard, so it is a
 * plain Claude Code session in this repository that happens to be shown here.
 * A review session keeps its standing instructions, or a "review 123 too" typed
 * mid-session would have no idea how to report what it finds.
 */
export async function sendMessage(sessionId: string, message: string, bare = false): Promise<void> {
  emit(sessionId, "chat.user", { text: message });
  await runSessionAgent({
    sessionId,
    label: "chat",
    // The session may pin its own model; settings are the fallback.
    model: getSession(sessionId).model ?? getSettings().models.chat,
    systemPrompt: bare ? undefined : sessionSystemPrompt(),
    prompt: message,
  });
}
