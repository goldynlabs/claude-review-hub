import { askClaude } from "./oneShot.js";

/**
 * Writing review criteria is not reviewing: it runs as its own Claude, once,
 * with nothing but the prompt the dashboard showed - which is built in the
 * browser, beside the one the Copy prompt button hands out, so there is still
 * one wording for it.
 */
export async function generateDimensions(prompt: string): Promise<string> {
  const text = await askClaude(prompt, "Answer with the JSON that was asked for and nothing else.");
  if (!text.trim()) throw new Error("Claude answered with nothing. Try again, or paste the JSON through Import.");
  return text;
}
