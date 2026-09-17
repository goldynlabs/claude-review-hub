import { runSessionAgent } from "../agent.js";
import { getSettings } from "../config.js";
import { getSession } from "../sessions.js";
import { emit } from "../events.js";
import { sessionSystemPrompt } from "./prompt.js";

/** Anything typed in the chat box, in the same session as the review. */
export async function sendMessage(sessionId: string, message: string): Promise<void> {
  emit(sessionId, "chat.user", { text: message });
  await runSessionAgent({
    sessionId,
    label: "chat",
    // The session may pin its own model; settings are the fallback.
    model: getSession(sessionId).model ?? getSettings().models.chat,
    systemPrompt: sessionSystemPrompt(),
    prompt: message,
  });
}
