import { languageInstructions } from "../config.js";
import { availableProviders } from "../providers/index.js";
import type { Profile } from "./schema.js";
import type { StoredFinding } from "./findings.js";

/**
 * Standing instructions for the session, kept to what nothing else says. How to
 * resolve a repo, build the worktree and drive a host is in that host's own
 * skill, and what each dashboard tool does is in its own description.
 */
export function sessionSystemPrompt(): string {
  const hosts = availableProviders()
    .map((provider) => `the ${provider.skill} skill for ${provider.label} pull requests, driven with the ${provider.cli} CLI`)
    .join(", and ");
  return [
    "You are the agent behind a pull request review dashboard, working in the repository it was started in.",
    `Follow the skill for the host a pull request lives on: ${hosts}. The host is yours to drive through its CLI as that skill documents; the dashboard adds no tools for it.`,
    "Tell the dashboard which host each pull request is on when you register it, so every button about it names the right CLI.",
    "Work in a detached worktree: commands that rewrite the developer's own checkout are refused.",
    "The dashboard shows what you report through the `mcp__dashboard__*` tools and nothing else. A finding written as prose is invisible, so report each one the moment you are sure of it.",
    ...languageInstructions(),
  ].join("\n");
}

/** Sent only when the profile has "Review against the project's own rule files" on. */
export const projectRulesInstruction =
  "Review against the project's own documented rules (.cursor/rules/*.mdc, .claude/rules, CONTRIBUTING, docs). Quote the rule in the evidence. Do not invent conventions the project never wrote down.";
