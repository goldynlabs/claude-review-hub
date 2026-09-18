import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./config.js";
import { dashboardTools } from "./mcp.js";
import { effectiveActions } from "./review/actions.js";
import { listProfiles } from "./review/profiles.js";
import { allProviders, reachableProviders } from "./providers/index.js";
import { discoverRepos } from "./repos.js";
import { projectRulesInstruction, sessionSystemPrompt } from "./review/prompt.js";
import { READ_ONLY_SOURCE, ALWAYS_ALLOWED, ALWAYS_CONFIRMED_SOURCE } from "./permissions.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ToolParam {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

export interface ToolInfo {
  server: string;
  name: string;
  description: string;
  params: ToolParam[];
}

/**
 * Reads a zod field well enough to document it. The shapes here are hand-written
 * and shallow, so this stays a reader rather than a schema printer.
 */
function describeParam(name: string, schema: any): ToolParam {
  let current = schema;
  let optional = false;
  const unwrap = new Set(["optional", "default", "nullable"]);

  while (current?._def && unwrap.has(String(current._def.type ?? current._def.typeName ?? "").replace("Zod", "").toLowerCase())) {
    if (String(current._def.type ?? current._def.typeName ?? "").toLowerCase().includes("optional")) optional = true;
    if (String(current._def.type ?? current._def.typeName ?? "").toLowerCase().includes("default")) optional = true;
    current = current._def.innerType ?? current._def.type ?? current;
    if (!current?._def) break;
  }

  const raw = String(current?._def?.type ?? current?._def?.typeName ?? "unknown").replace(/^Zod/, "");
  const values = current?._def?.entries ?? current?._def?.values;
  const type = values ? `enum(${Object.values(values).join(" | ")})` : raw.toLowerCase();

  return { name, type, optional, description: schema?.description ?? current?.description };
}

function toolInfo(server: string, tools: Array<{ name: string; description: string; inputSchema: any }>): ToolInfo[] {
  return tools.map((tool) => ({
    server,
    name: `mcp__${server}__${tool.name}`,
    description: tool.description,
    params: Object.entries(tool.inputSchema ?? {}).map(([name, schema]) => describeParam(name, schema)),
  }));
}

/**
 * Everything the agent is given, in one payload: the tools it can call, the
 * prompts every button sends, the rules that gate it, and the skill it follows.
 * Meant to be read by whoever has to maintain this, including its own author.
 */
export function inspect() {
  const context = { sessionId: "inspect" };
  // Every host the tool knows, so this tab documents what it supports rather
  // than only what this machine happens to have installed.
  const providers = allProviders();
  const reachable = new Set(reachableProviders().map((provider) => provider.kind));

  return {
    /** How a review actually runs, in the order it happens. */
    flow: [
      {
        step: "One Claude Code session",
        detail:
          "A dashboard session is one Claude Code session, started in this repository and resumed for every later turn. Its id is shown in the chat panel, and `claude --resume <id>` opens the same conversation in a terminal.",
      },
      {
        step: "The agent does the work",
        detail:
          "Resolving the PR, fetching, building a detached worktree, producing the diff, reading the code, posting comments: all of it the agent does itself, with git and the CLI of the host the PR lives on, following that host's skill. The server runs none of it.",
      },
      {
        step: "It reports back",
        detail:
          "The panels are drawn from the four dashboard tools below. Anything the agent does not report stays invisible to the dashboard, however well it describes it in prose.",
      },
      {
        step: "Nothing is sent unasked",
        detail:
          "Every button that puts the agent to work opens a confirmation first: it shows the exact prompt and takes an optional note that is appended to it, so Review, Re-review, Post to PR, Approve and thread states can all be aimed before they are sent. The ones that change the pull request say so, in red. Reply goes straight to the host without the agent, so its confirmation previews the comment itself. Resolve and Dismiss only change the dashboard, and ask for a second click rather than a dialog. While a turn is running, the buttons that would start another one are disabled and the server refuses them, so a repeated click cannot queue the same request twice.",
      },
      {
        step: "The server keeps the record",
        detail:
          "Sessions, PRs, findings, evidence and verdicts live in SQLite under .review-tool/data, with an append-only event log per session. The UI is a projection of that log.",
      },
      {
        step: "What the server still does itself",
        detail:
          "Read-only work for the screen: fetching comment threads for the Threads tab, running `git diff` for the Diff tab, discovering local checkouts, and working out which host the repo belongs to. None of it changes anything.",
      },
    ],
    // The templates in force, so a rewritten one is what this tab documents.
    actions: effectiveActions(),
    /** What each placeholder in a template stands for, shown on hover. */
    placeholders: {
      request: "What you typed in the review box, plus any standing context saved on the session.",
      profile_dimensions:
        "One section per enabled dimension of the session's profile: its label, its id, and the prompt it carries. Settings > Profiles.",
      project_rules: `Present only when Settings has "Review against the project's own rule files" on, and then it reads:\n\n${projectRulesInstruction}`,
      profile_context:
        "The profile's standing context, under the heading '## Standing context for this profile'. Empty profiles contribute nothing here.",
      file_filters:
        "The profile's globs, as 'Ignore files matching: …' and 'Review only files matching: …'. Neither line appears when the profile sets no globs.",
      severity_floor: "The profile's severity floor. Anything below it is not reported at all.",
      profiles:
        "Every review profile by id, name and standing context - not its dimensions. Auto detect is choosing between them, not running them.",
      pull_requests:
        "The pull requests this session has registered: number, repo, title, author and the files each one changes.",
      per_pr_briefs:
        "One section per pull request, built from what Auto detect settled in its modal: the dimensions of the profile picked for it, that profile's context, globs and severity floor, and the note written for that pull request alone. A pull request with no profile carries its note and nothing else.",
      note:
        "Whatever you type in the note box of the confirmation, under the heading '## What the reviewer asked for'. Left empty, the whole section disappears.",
      argument:
        "The note box, for a challenge: it becomes a section headed '## The reviewer disagrees, and says:', followed by an instruction to verify the claim against the code. Left empty, the section disappears.",
      finding_list: "One line per selected finding: its id, severity, file and line, and title.",
      finding_place: "The finding's file, and its line when it has one.",
      finding_confidence: "The confidence it carries now, before this re-check.",
      finding_title: "The finding's one-line title, as reported.",
      finding_detail: "The finding's full explanation, as reported.",
      finding_evidence: "The evidence array of the finding, as JSON, exactly as it was reported.",
      findingId: "The id of the finding the button belongs to.",
      prId: "The pull request number the button belongs to.",
      repo: "The repository that pull request lives in.",
      threadId: "The comment thread the button belongs to.",
      status:
        "The thread state picked in the dropdown, in the host's own vocabulary: active, pending, fixed, wontFix or closed on Azure DevOps; active or resolved on GitHub.",
      content: "The reply text typed in the thread.",
      cli: "The CLI of the host this pull request lives on: `az` for Azure DevOps, `gh` for GitHub.",
      skill: "The skill that documents that CLI: azure-pr-master or github-pr-master.",
      with_cli:
        "How to post, for the selected findings: named outright when they share a host, and left to each pull request's own host when they do not.",
    },
    tools: toolInfo("dashboard", dashboardTools(context)),
    prompts: {
      system: sessionSystemPrompt(),
      // One per host the agent can actually drive on this machine.
      skills: providers.map((provider) => {
        const file = path.resolve(here, `../../skill/${provider.skill}/SKILL.md`);
        return {
          name: provider.skill,
          host: provider.label,
          markdown: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
        };
      }),
    },
    hosts: providers.map((provider) => ({
      provider: provider.kind,
      label: provider.label,
      cli: provider.cli,
      skill: provider.skill,
      threadStates: provider.threadStates,
      /** False when its CLI is not on this machine, so nothing can drive it. */
      reachable: reachable.has(provider.kind),
    })),
    permissions: {
      mode: getSettings().permissionMode,
      alwaysAllowed: ALWAYS_ALLOWED,
      readOnlyShell: READ_ONLY_SOURCE,
      alwaysConfirmed: ALWAYS_CONFIRMED_SOURCE,
      blockedNote:
        "Destructive git (checkout, switch, reset, clean, stash, pull, merge, rebase, cherry-pick, restore) is refused outright unless it targets a worktree under .review-tool/temp/worktrees/, in every permission mode.",
    },
    repos: discoverRepos(),
    profiles: listProfiles(),
    models: getSettings().models,
  };
}
