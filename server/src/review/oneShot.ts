import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getSettings } from "../config.js";
import { ClaudeCodeMissing, findClaudeCode } from "../claudeCode.js";
import { projectRoot } from "../paths.js";

/**
 * A Claude of its own, for the questions the dashboard asks on the reviewer's
 * behalf rather than about a review: writing dimensions, picking which profile
 * fits a pull request. None of them needs a worktree, a host, the dashboard
 * tools or anything the session agent has already read, and none of them
 * should land in the session's transcript, so none of them runs there.
 */
export async function askClaude(prompt: string, systemPrompt: string): Promise<string> {
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
      systemPrompt,
    },
  });

  let text = "";
  for await (const message of conversation as AsyncIterable<SDKMessage>) {
    if (message.type !== "assistant") continue;
    for (const block of message.message.content) if (block.type === "text") text += block.text;
  }
  return text;
}
