import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getSettings } from "../config.js";
import { ClaudeCodeMissing, findClaudeCode } from "../claudeCode.js";
import { projectRoot } from "../paths.js";

/**
 * Writing review criteria is not reviewing: it needs no worktree, no host, no
 * dashboard tools and none of what the session agent has already read. So it
 * runs as its own Claude, once, with nothing but the prompt the dashboard
 * showed - which is built in the browser, beside the one the Copy prompt
 * button hands out, so there is still one wording for it.
 */
export async function generateDimensions(prompt: string): Promise<string> {
  const executable = findClaudeCode();
  if (!executable) throw new ClaudeCodeMissing();

  const conversation = query({
    prompt,
    options: {
      cwd: projectRoot,
      pathToClaudeCodeExecutable: executable,
      model: getSettings().models.chat,
      // One answer, from the prompt alone: no tools to read the repo with, and
      // no settings of the developer's to pull a skill or a rule file in.
      maxTurns: 1,
      allowedTools: [],
      settingSources: [],
      systemPrompt: "Answer with the JSON that was asked for and nothing else.",
    },
  });

  let text = "";
  for await (const message of conversation as AsyncIterable<SDKMessage>) {
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) if (block.type === "text") text += block.text;
  }
  if (!text.trim()) throw new Error("Claude answered with nothing. Try again, or paste the JSON through Import.");
  return text;
}
