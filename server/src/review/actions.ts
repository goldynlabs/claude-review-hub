import { runSessionAgent } from "../agent.js";
import { getSettings } from "../config.js";
import { providerFor } from "../providers/index.js";
import { emit } from "../events.js";
import { getFinding } from "./findings.js";
import { getProfile } from "./profiles.js";
import { projectRulesInstruction, sessionSystemPrompt } from "./prompt.js";
import { findSessionPr, getSession, getSessionPr, type SessionPr } from "../sessions.js";
import { getPromptOverride } from "./promptStore.js";
import type { Profile } from "./schema.js";

const NEWLINE = "\n";

/**
 * Every button in the dashboard is a turn of the session's agent, and the user
 * is entitled to see the words it will send. Templates live here so the tooltip
 * and the request cannot drift apart: the client renders the same string the
 * server builds.
 */
export type ActionCategory = "Session" | "Pull request" | "Findings" | "Threads";

export interface ActionTemplate {
  id: string;
  label: string;
  /** Which surface the button belongs to, for grouping. */
  category: ActionCategory;
  /** Where to find it on screen, in the words of someone looking at it. */
  where: string;
  /** `{placeholder}` is filled from the params the button passes. */
  template: string;
  /** The prompt is assembled on the server from stored data, not the template. */
  computed?: boolean;
  /**
   * Changes something on the host: a comment, a vote, a thread state, a merge.
   * Those leave the dashboard and are seen by other people, so the UI asks
   * before sending one. Reading a PR or arguing with a finding does not.
   */
  writes?: boolean;
}

const NOTE_HEADING = "## What the reviewer asked for";

/**
 * `{note}` is a section, not a word: it brings its own heading when the
 * reviewer wrote something and disappears entirely when they did not. Every
 * template ends with it, so the templates shown in the dashboard are the whole
 * of what is sent rather than most of it.
 */
function noteSection(note: unknown): string {
  const text = typeof note === "string" ? note.trim() : "";
  return text ? `${NEWLINE}${NEWLINE}${NOTE_HEADING}${NEWLINE}${text}` : "";
}

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    id: "review",
    label: "Review",
    category: "Session",
    where:
      "The review box: the sidebar when creating a session, or 'Add PRs' in the session header.",
    // This is the prompt. Everything that varies is a placeholder filled from
    // the session's profile, so what is shown here and what is sent are one
    // string with different substitutions, not two texts to keep in step.
    template: [
      "# Review request",
      "{request}",
      "",
      "Work through it end to end: resolve each pull request, prepare its worktree, produce the diff, register it with the dashboard, then review it.",
      "",
      "## Review dimensions",
      "{profile_dimensions}",
      "{dimension_agents}{profile_context}{project_rules}{file_filters}",
      "Report only findings at severity {severity_floor} or above.",
      "{verify_pass}",
      "Finish with one short paragraph: what the PR does, and whether you would block it.{note}",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "pr.review",
    label: "Re-review this PR",
    category: "Pull request",
    where:
      "PR toolbar, beside the branch line. Reads 'Review' or 'Re-review'.",
    template:
      "Review pull request {prId} in {repo} again, from scratch. Refresh its worktree and diff first, then report what you find now.{note}",
  },
  {
    id: "pr.approve",
    writes: true,
    label: "Approve",
    category: "Pull request",
    where:
      "PR toolbar, beside the branch line.",
    template:
      "Approve pull request {prId} in {repo} with the {cli} CLI, as the {skill} skill documents. Say in one line what you are approving, then do it.{note}",
    computed: true,
  },
  {
    id: "pr.reject",
    writes: true,
    label: "Reject",
    category: "Pull request",
    where:
      "Not on screen yet; available through the chat box.",
    template:
      "Reject pull request {prId} in {repo} with the {cli} CLI, as the {skill} skill documents, and post a general comment saying briefly why, based on the critical findings.{note}",
    computed: true,
  },
  /* Wait for author (vote -5): its button is commented out in SessionView, and
     the dashboard never showed the result, so the action is off too. Ask for it
     in the chat box instead.
  {
    id: "pr.waiting",
    writes: true,
    label: "Wait for author",
    category: "Pull request",
    where:
      "Not on screen yet; available through the chat box.",
    template: "Vote -5 (waiting for the author) on pull request {prId} in {repo}.",
  },
  */
  /* Merge: no button anywhere, and completing a PR is not this tool's job.
     Ask for it in the chat box if you really want it from here.
  {
    id: "pr.complete",
    writes: true,
    label: "Merge",
    category: "Pull request",
    where:
      "Not on screen yet; available through the chat box.",
    template: "Complete (squash merge) pull request {prId} in {repo}. Do not delete the source branch.",
  },
  */
  {
    id: "finding.challenge",
    label: "Challenge",
    category: "Findings",
    where:
      "Finding card: the Challenge button, and 'Re-check this finding' once it opens.",
    // This is the prompt: the challenge is built by filling this in, so the
    // template shown in the dashboard is not a description of it.
    template: [
      "# Challenge one of your findings",
      "Try to **refute** it by reading the actual code. Do not defend it out of politeness, and do not agree with it just because it is already written down.",
      "",
      "Finding `{findingId}` · {finding_place} · current confidence {finding_confidence}",
      "**{finding_title}**",
      "{finding_detail}",
      "",
      "Evidence originally given:",
      "```json",
      "{finding_evidence}",
      "```",
      "{argument}",
      "",
      "Open the real files in the worktree. Follow the call sites. Check whether a guard, default, framework behaviour or earlier validation already handles the case.",
      "Then call `mcp__dashboard__report_verdict` exactly once with the finding id, whether it still holds, your new confidence, and the specific code that decided it.",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "finding.post",
    writes: true,
    label: "Post to PR",
    category: "Findings",
    where:
      "Finding card, action row: 'Post to PR'.",
    template:
      "Post finding {findingId} to its pull request as an inline comment: read it, write the comment yourself with the {cli} CLI as the {skill} skill documents, then call mcp__dashboard__mark_finding_posted with the thread id you get back.{note}",
    computed: true,
  },
  {
    id: "finding.resolve",
    writes: true,
    label: "Resolve",
    category: "Findings",
    where: "Finding card, action row: 'Resolve'.",
    template: [
      "Finding {findingId} is dealt with.",
      "{thread_hint}",
      "Then call `mcp__dashboard__mark_finding_resolved` for it, so the dashboard takes it off the open list.{note}",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "findings.post",
    writes: true,
    label: "Post findings to PR",
    category: "Findings",
    where: "Findings tab, selection bar: 'Post to PR' once findings are ticked.",
    template: [
      "# Post these findings to their pull request",
      "",
      "Post each one as an inline comment {with_cli}, then call `mcp__dashboard__mark_finding_posted` for it so the dashboard stops showing it as unposted.",
      "",
      "{finding_list}{note}",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "findings.challenge",
    label: "Challenge findings",
    category: "Findings",
    where: "Findings tab, selection bar: 'Challenge' once findings are ticked.",
    template: [
      "# Re-check these findings",
      "",
      "For each one, try to refute it by reading the code, then call `mcp__dashboard__report_verdict` once for that finding.",
      "",
      "{finding_list}{note}",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "thread.reply",
    writes: true,
    label: "Reply",
    category: "Threads",
    where: "Thread card footer: 'Reply'.",
    template: [
      "Reply to comment thread {threadId} on pull request {prId} in {repo}. Post this text as written, with the {cli} CLI as the {skill} skill documents:",
      "",
      "{content}{note}",
    ].join(NEWLINE),
    computed: true,
  },
  {
    id: "thread.status",
    writes: true,
    label: "Set thread status",
    category: "Threads",
    where:
      "Thread card footer: the status dropdown.",
    // The vocabulary is the host's own: Azure DevOps has five states, GitHub
    // resolves a conversation or does not. The dropdown offers only its own.
    template:
      "Set comment thread {threadId} on pull request {prId} to {status}, with the {cli} CLI as the {skill} skill documents.{note}",
    computed: true,
  },
];

/** The challenge's note, which argues with the finding rather than adding to it. */
function argumentSection(argument: unknown): string {
  const text = typeof argument === "string" ? argument.trim() : "";
  if (!text) return "";
  return [
    "",
    "## The reviewer disagrees, and says:",
    text,
    "",
    "Verify their claim against the code before you accept it.",
  ].join(NEWLINE);
}

/**
 * The host words a prompt needs: which CLI to drive, and which skill says how.
 * A pull request always knows its own host, so no button has to guess.
 */
function hostWords(pr: SessionPr | null): { cli: string; skill: string; host: string } {
  const provider = providerFor(pr?.provider ?? "azure");
  return { cli: provider.cli, skill: provider.skill, host: provider.label };
}

/**
 * The same, for a set of findings that may not share a host. Several hosts in
 * one selection is rare but real, and saying "the az CLI" there would be wrong
 * for half of them.
 */
function withCli(prs: SessionPr[]): string {
  const kinds = new Set(prs.map((pr) => pr.provider));
  if (kinds.size === 1) {
    const { cli, skill } = hostWords(prs[0]);
    return `with the ${cli} CLI, as the ${skill} skill documents`;
  }
  return "with the CLI its own host uses, as that host's skill documents";
}

export function fillTemplate(
  template: string,
  params: Record<string, unknown>,
  /** Keys to leave as `{key}`, because their value is shown on hover instead. */
  keep: Record<string, string> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (key in keep) return match;
    if (key === "note") return noteSection(params.note);
    if (key === "argument") return argumentSection(params.argument);
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Accepts an array from a POST body, or a comma-separated list from a query. */
function findingIdsOf(params: Record<string, unknown>): string[] {
  const raw = params.findingIds;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return [];
}

/**
 * How the dimensions are worked through. One subagent each reads the diff once
 * per dimension, so it costs several times the tokens; the profile decides,
 * and says nothing when it is off, which is the single reviewer we always had.
 */
function dimensionAgents(profile: Profile): string {
  if (!profile.parallelDimensions) return "";
  return [
    "",
    "Review the dimensions in parallel: one subagent per dimension, launched together in a single message, each given only that dimension's brief and the diff.",
    "They are yours to wait for, in this same turn: no background or async agents, no scheduled wake-up, nothing that ends the turn and resumes later. Each one answers you with its findings - file, line, severity, confidence, evidence - and **you** call `mcp__dashboard__report_finding` for every one of them, with that dimension's id. A subagent cannot reach the dashboard; a finding it only wrote out in prose is a finding nobody will ever see.",
    "",
  ].join(NEWLINE);
}

/**
 * The second pass: every finding is argued with before the run ends, so the
 * confidence on screen is one the code decided rather than the one the first
 * reader guessed. It is an agent per finding, so it is off unless asked for.
 */
function verifyPass(profile: Profile): string {
  if (!profile.verifyFindings) return "";
  return [
    "",
    "## Verify before you finish",
    "When every finding is reported, re-check them: one subagent per finding, launched together in a single message and waited for in this same turn - no background or async agents - each told to **refute** its finding by reading the real files and following the call sites. Each answers you with whether it still holds, a new confidence and the code that decided it, and **you** call `mcp__dashboard__report_verdict` once per finding. Do not skip the ones you are sure of.",
    "",
  ].join(NEWLINE);
}

/** The profile's include and exclude globs, as the lines the agent reads. */
function fileFilters(profile: Profile): string {
  const lines: string[] = [];
  if (profile.exclude.length) lines.push(`Ignore files matching: ${profile.exclude.join(", ")}`);
  if (profile.include.length) lines.push(`Review only files matching: ${profile.include.join(", ")}`);
  return lines.length ? `${NEWLINE}${lines.join(NEWLINE)}${NEWLINE}` : "";
}

/** One line per finding, so the agent knows exactly which ones are meant. */
function findingList(ids: string[]): string {
  return ids
    .map((id) => {
      const finding = getFinding(id);
      const place = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
      return `- \`${finding.id}\` ${finding.severity} · ${place} · ${finding.title}`;
    })
    .join(NEWLINE);
}

/**
 * The template in force: what Settings > Prompts saved for this action, or the
 * built-in one. Everything that builds or shows a prompt goes through here, so
 * an override reaches the hover, the confirmation and the agent alike.
 */
export function templateOf(action: ActionTemplate): string {
  return getPromptOverride(action.id) ?? action.template;
}

/** What every surface should show: the template in force, and whether it was rewritten. */
export interface EffectiveAction extends ActionTemplate {
  overridden: boolean;
  /** The built-in wording, so Settings can offer to put it back. */
  defaultTemplate: string;
}

export function effectiveActions(): EffectiveAction[] {
  return ACTION_TEMPLATES.map((action) => ({
    ...action,
    template: templateOf(action),
    defaultTemplate: action.template,
    overridden: templateOf(action) !== action.template,
  }));
}

/** Builds the exact prompt an action will send. */
export function buildActionPrompt(actionId: string, params: Record<string, unknown>): string {
  const { action, values } = resolveAction(actionId, params);
  return fillTemplate(templateOf(action), values);
}

/**
 * Values kept as their placeholder on screen: read in full they are a wall.
 * A single line never is, however long, so only paragraphs qualify on length.
 */
const TOO_LONG_TO_SHOW = 300;

/** Never hidden: the reviewer wrote these, in the box right above the preview. */
const ALWAYS_SHOWN = new Set(["note", "argument"]);

/**
 * The same prompt, for reading rather than sending. Anything long stays as its
 * placeholder and its real value is returned separately, so the dashboard can
 * show it on hover instead of pasting a page of JSON into the middle of a
 * sentence. The agent is still sent the filled-in version.
 */
export function buildActionPreview(
  actionId: string,
  params: Record<string, unknown>,
): { prompt: string; values: Record<string, string>; full: string } {
  const { action, values, unset = [] } = resolveAction(actionId, params);

  const shown: Record<string, unknown> = {};
  const hidden: Record<string, string> = {};
  // Nothing typed yet: show the placeholder rather than the stand-in the agent
  // would get, so the box the reviewer is about to fill is visible in the prompt.
  const blank = Object.fromEntries(unset.map((key) => [key, ""]));
  for (const [key, value] of Object.entries(values)) {
    if (key in blank) continue;
    const text = value === undefined || value === null ? "" : String(value);
    const bulky = !ALWAYS_SHOWN.has(key) && (text.length > TOO_LONG_TO_SHOW || text.includes(NEWLINE));
    if (bulky) hidden[key] = text;
    else shown[key] = value;
  }

  // A key left out of `shown` keeps its own `{placeholder}` in the output.
  // `full` is what actually goes, and what editing starts from: editing the
  // reading form would send a literal `{placeholder}` to the agent.
  return {
    prompt: fillTemplate(templateOf(action), shown, { ...hidden, ...blank }),
    values: hidden,
    full: fillTemplate(templateOf(action), values),
  };
}

function resolveAction(
  actionId: string,
  params: Record<string, unknown>,
): {
  action: ActionTemplate;
  values: Record<string, unknown>;
  /** Params the reviewer has not supplied yet, kept as placeholders on screen. */
  unset?: string[];
} {
  const action = ACTION_TEMPLATES.find((item) => item.id === actionId);
  if (!action) {
    // Almost always a dashboard newer than the process serving it, since the
    // page reloads on rebuild and a running server does not.
    throw new Error(
      `Unknown action: ${actionId}. This server does not know it, which usually means the tool was rebuilt after it started. Restart claude-review-hub.`,
    );
  }

  if (actionId === "review") {
    // The sidebar shows this prompt before the session exists: nothing is
    // created while the reviewer is still reading what will be sent. With no
    // session yet the profile comes from the picker in the form instead.
    const sessionId = String(params.sessionId ?? "");
    const session = sessionId ? getSession(sessionId) : null;
    const profile = getProfile(session?.profileId || String(params.profileId ?? "") || "default");
    const asked = String(params.request ?? "").trim();
    return { action, unset: asked ? [] : ["request"], values: {
      ...params,
      request:
        [asked, session?.extraContext].filter(Boolean).join(`${NEWLINE}${NEWLINE}`) ||
        "Review the pull requests already registered in this session.",
      profile_dimensions: profile.dimensions
        .filter((dimension) => dimension.enabled)
        .map((dimension) => `### ${dimension.label} (dimension id: \`${dimension.id}\`)${NEWLINE}${dimension.prompt}`)
        .join(`${NEWLINE}${NEWLINE}`),
      dimension_agents: dimensionAgents(profile),
      verify_pass: verifyPass(profile),
      profile_context: profile.context.trim()
        ? `${NEWLINE}## Standing context for this profile${NEWLINE}${profile.context.trim()}${NEWLINE}`
        : "",
      project_rules: profile.useProjectRules ? `${NEWLINE}${projectRulesInstruction}${NEWLINE}` : "",
      file_filters: fileFilters(profile),
      severity_floor: profile.severityFloor,
    } };
  }

  if (actionId === "findings.post" || actionId === "findings.challenge") {
    const ids = findingIdsOf(params);
    if (!ids.length) return { action: { ...action, template: "No findings were selected." }, values: {} };
    // Built from the template itself, so the words shown in the dashboard and
    // the words sent cannot drift apart.
    const prs = ids.map((id) => getSessionPr(getFinding(id).sessionPrId));
    return { action, values: { ...params, finding_list: findingList(ids), with_cli: withCli(prs) } };
  }

  if (actionId === "finding.post") {
    const finding = getFinding(String(params.findingId ?? ""));
    return { action, values: { ...params, ...hostWords(getSessionPr(finding.sessionPrId)) } };
  }

  if (["thread.reply", "thread.status", "pr.approve", "pr.reject"].includes(actionId)) {
    // These all name a pull request, and the pull request names the host.
    const pr = findSessionPr(String(params.sessionId ?? ""), Number(params.prId) || undefined);
    return { action, values: { ...params, ...hostWords(pr) } };
  }

  if (actionId === "finding.resolve") {
    const finding = getFinding(String(params.findingId ?? ""));
    const pr = getSessionPr(finding.sessionPrId);
    return {
      action,
      values: {
        ...params,
        findingId: finding.id,
        // Resolving a finding that was never posted is bookkeeping; resolving
        // one that was is a thread on the pull request that should close too.
        thread_hint: finding.threadId
          ? `It was posted to pull request ${pr.prId} in ${pr.repo} as comment thread ${finding.threadId}. ${providerFor(pr.provider).closeThreadPhrase} with the ${providerFor(pr.provider).cli} CLI first.`
          : `It was never posted to the pull request, so there is nothing to close on ${providerFor(pr.provider).label}.`,
      },
    };
  }

  if (actionId === "finding.challenge") {
    const finding = getFinding(String(params.findingId ?? ""));
    // The note box is the argument here: one control, one meaning.
    return { action, values: {
      findingId: finding.id,
      finding_place: `${finding.file}${finding.line ? `:${finding.line}` : ""}`,
      finding_confidence: finding.confidence,
      finding_title: finding.title,
      finding_detail: finding.detail,
      finding_evidence: JSON.stringify(finding.evidence, null, 2),
      argument: params.argument ?? params.note,
    } };
  }

  // Everything else is its template, filled in. `{note}` is part of it.
  return { action, values: params };
}

/** Model per action: a challenge argues with itself and deserves the better one. */
function modelFor(actionId: string, sessionId: string): string {
  const models = getSettings().models;
  if (actionId === "review") return models.review;
  if (actionId === "finding.challenge" || actionId === "findings.challenge") return models.challenge;
  // Everything else runs as chat does, so the session's own choice wins.
  return getSession(sessionId).model ?? models.chat;
}

export async function runAction(
  sessionId: string,
  actionId: string,
  params: Record<string, unknown>,
  /**
   * What the reviewer edited in the confirmation, sent instead of the built
   * prompt. The template is a starting point, not a cage: anything a button
   * cannot express should be sayable by rewriting what it was going to send.
   */
  edited?: string,
): Promise<void> {
  const built = buildActionPrompt(actionId, { ...params, sessionId });
  const prompt = edited?.trim() ? edited.trim() : built;
  emit(sessionId, "action.started", { actionId, params, prompt, edited: prompt !== built });
  await runSessionAgent({
    sessionId,
    label: actionId,
    model: modelFor(actionId, sessionId),
    systemPrompt: sessionSystemPrompt(),
    prompt,
  });
}

