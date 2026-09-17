import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import type { Profile } from "../lib/types";
import { Accordion } from "./ui/Accordion";
import { Markdown } from "./ui/Markdown";
import { Modal } from "./ui/Modal";
import { StatusBadge } from "./ui/StatusBadge";
import { PromptView } from "./PromptView";
import { Tooltip } from "./ui/Tooltip";

interface ToolParam {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

interface Inspection {
  actions?: Array<{
    id: string;
    label: string;
    category: string;
    where: string;
    template: string;
    computed?: boolean;
    writes?: boolean;
  }>;
  tools?: Array<{ server: string; name: string; description: string; params: ToolParam[] }>;
  prompts?: { system: string; skills: Array<{ name: string; host: string; markdown: string }> };
  permissions?: {
    mode: string;
    alwaysAllowed: string[];
    readOnlyShell: string[];
    alwaysConfirmed: string[];
    blockedNote: string;
  };
  placeholders?: Record<string, string>;
  repos?: Record<string, string>;
  profiles?: Profile[];
  models?: { review: string; challenge: string; chat: string };
}

const ACTION_GROUPS = ["Session", "Pull request", "Findings", "Threads"];

type Tab = "faq" | "glossary" | "actions" | "tools" | "prompts" | "permissions" | "profiles";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "faq", label: "FAQ", hint: "Start here: the questions everyone asks in their first hour" },
  { id: "glossary", label: "Glossary", hint: "Every word the dashboard uses, and the record behind it, field by field" },
  { id: "actions", label: "Actions", hint: "Every button that talks to the agent, where it lives, and the words it sends" },
  { id: "tools", label: "Tools", hint: "The only tools it is given; the host it drives itself through the CLI" },
  { id: "prompts", label: "Prompts", hint: "The standing instructions and the skill it follows per host" },
  { id: "permissions", label: "Permissions", hint: "What runs unattended, what is asked, what is refused" },
  { id: "profiles", label: "Profiles", hint: "The review criteria, as configured" },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is this thing?",
    a: "A dashboard over one Claude Code session that reviews pull requests on Azure DevOps and on GitHub. The agent does the work with git and the host's own CLI, az or gh; the dashboard shows what it reported and gives you buttons for the things you would otherwise have to type.",
  },
  {
    q: "How do I start a review?",
    a: "Sidebar, New review session. Pick a profile, then paste PR numbers, paste PR URLs from any organisation, or just describe what you want looked at. Create, and the review starts.",
  },
  {
    q: "What happens while it runs?",
    a: "The agent resolves each PR, fetches it, builds a throwaway worktree under .review-tool/temp/worktrees, produces the diff, reads the code around it, and reports findings back. Nothing is posted to the pull request at this stage.",
  },
  {
    q: "What is a finding, and why did it skip something I care about?",
    a: "A finding is one reported problem with a severity. The profile's severity floor drops anything below it, and its dimensions decide what is looked for at all. If reviews feel too quiet or too noisy, that is the knob; see the Profiles tab.",
  },
  {
    q: "What does Challenge do?",
    a: "It re-checks a single finding adversarially: a second run whose job is to prove the finding wrong. Use it before posting anything you are unsure about. Challenge findings does the same for the whole run.",
  },
  {
    q: "How does anything reach the pull request?",
    a: "Only when you ask. Post to PR sends one finding as an inline comment; Post findings to PR sends the run. Approve and Reject set your vote on the PR, nothing else.",
  },
  {
    q: "Can it do something I did not ask for?",
    a: "In Ask mode every write is confirmed in the chat panel first. In Auto mode they run unattended. Destructive git is refused outright in either mode unless it targets a review worktree. See the Permissions tab.",
  },
  {
    q: "The buttons do not cover what I want.",
    a: "Type it in the chat panel on the right. It is the same session the buttons drive, so anything you can describe, it can do. The buttons are only shortcuts for the common phrasings.",
  },
  {
    q: "Where do I change the model or the language findings are written in?",
    a: "Settings, under General. Review, Challenge and Chat each take their own model. Language is two settings: Session language is what Claude writes here (findings, chat), Pull request language is what it writes into the pull request, on whichever host. The prompts Claude is sent are always English.",
  },
  {
    q: "Can I keep going in a terminal?",
    a: "Yes. The session id is shown in the chat panel; claude --resume <id> opens the same conversation in a terminal, with all of its history.",
  },
];

interface GlossaryField {
  name: string;
  type: string;
  note: string;
}

interface Term {
  name: string;
  /** Where the thing is seen, or what it is called in the source. */
  where: string;
  what: string;
  fields?: GlossaryField[];
}

/**
 * The records the dashboard is made of, named as the API serves them. Kept
 * beside the FAQ because the questions it answers are the next ones asked:
 * what is this field, and what may it hold.
 */
const GLOSSARY: Array<{ group: string; terms: Term[] }> = [
  {
    group: "What a review is made of",
    terms: [
      {
        name: "Session",
        where: "One row in the sidebar; one Claude Code conversation",
        what: "A review run: a profile, the pull requests you put in it, and everything reported since. It is backed by a single Claude Code session, so the buttons and the chat box all continue the same conversation, and it survives a restart.",
        fields: [
          { name: "id", type: "string", note: "The dashboard's own id, the one in the URL." },
          { name: "title", type: "string", note: "The name in the sidebar." },
          { name: "titleAuto", type: "boolean", note: "True while the title is still derived from the PRs in the session. Renaming it by hand sets this false and the title is left alone." },
          {
            name: "status",
            type: "idle | running | done | error | stopped",
            note: "idle before anything ran; running while a turn is in flight, which is what disables the buttons; done when the last turn finished cleanly; error when it failed; stopped when you stopped it, or when the server restarted while it was running.",
          },
          { name: "profileId", type: "string | null", note: "The profile every PR in the session is reviewed against." },
          { name: "extraContext", type: "string | null", note: "Standing context typed when the session was created. It travels with every request, on top of the profile's own context." },
          { name: "claudeSessionId", type: "string | null", note: "The Claude session the chat box continues." },
          { name: "lastClaudeSessionId", type: "string | null", note: "The most recent Claude session of any kind, review, challenge or chat. This is the id to pass to claude --resume." },
          { name: "lastClaudeLabel", type: "string | null", note: "Which run that last session was." },
          { name: "model", type: "string | null", note: "Chat model pinned for this session. Null uses the one in Settings." },
          { name: "costUsd", type: "number", note: "What the session has cost so far, summed over its turns. Shown only when Settings has cost display on." },
          { name: "createdAt / updatedAt", type: "ISO 8601 string", note: "When it was created, and when anything on it last changed." },
        ],
      },
      {
        name: "Pull request",
        where: "A tab inside a session (SessionPr in the API)",
        what: "One pull request as it exists inside one session. It is not the pull request itself: it is what the agent reported after resolving it, plus the local checkout and the throwaway worktree it built to read the diff. The same PR in two sessions is two of these.",
        fields: [
          { name: "id", type: "string", note: "The dashboard's id for this PR-in-this-session. Findings hang off it." },
          { name: "prId", type: "number", note: "The pull request number on the host." },
          { name: "provider", type: "azure | github", note: "Which host it lives on. The agent names it; when it cannot, the checkout's origin remote decides, and failing that it is assumed to be Azure DevOps." },
          { name: "org", type: "string", note: "Azure DevOps organisation, or GitHub owner." },
          { name: "project", type: "string", note: "Azure DevOps team project. GitHub has no such level and leaves it empty." },
          { name: "repo", type: "string", note: "The repository the PR is in." },
          { name: "repoPath", type: "string | null", note: "Absolute path of the local checkout on this machine." },
          { name: "worktreePath", type: "string | null", note: "The detached worktree built to read the PR, under .review-tool/temp/worktrees. Disposable; a TTL in Settings decides how long it is kept." },
          { name: "title / author", type: "string | null", note: "As reported by the agent from the host." },
          { name: "prStatus", type: "string | null", note: "The pull request's own state in the host's words, such as active, completed or abandoned on Azure DevOps. It is passed through as reported, not normalised." },
          { name: "sourceBranch / targetBranch", type: "string | null", note: "What is being merged, and into what." },
          {
            name: "state",
            type: "pending | ready | reviewing | reviewed | error",
            note: "Where this PR is in the dashboard's own flow. pending is a PR known but not yet prepared; ready is set the moment the agent registers it with its worktree and file list; reviewing, reviewed and error are the states the PR list draws differently when a review reports them.",
          },
          { name: "error", type: "string | null", note: "Why preparing or reviewing it failed." },
          { name: "files", type: "ChangedFile[]", note: "The changed-file list behind the Diff tab, from git diff --numstat: file, status (added, modified, deleted or renamed), additions, deletions." },
          { name: "claudeSessionId", type: "string | null", note: "The Claude session that reviewed this PR. Challenge and chat continue it, because a session is bound to the directory it started in, and that is this PR's worktree." },
        ],
      },
      {
        name: "Finding",
        where: "A card under a PR tab",
        what: "One reported problem, with a severity and at least one piece of evidence. The agent reports it through a tool call, never as prose: something described only in the transcript cannot be filtered, challenged, posted or dismissed.",
        fields: [
          { name: "id", type: "string", note: "What every finding-scoped button sends." },
          { name: "sessionPrId", type: "string", note: "The PR it belongs to." },
          { name: "runId", type: "string | null", note: "The agent turn that reported it." },
          { name: "superseded", type: "boolean", note: "Computed, not stored: true when a newer review of the same PR has run. Re-reviewing appends rather than deletes, so earlier findings keep their verdicts and your decisions, and are moved out of the way rather than lost." },
          { name: "file", type: "string", note: "Repo-relative path." },
          { name: "line / endLine", type: "number | null", note: "1-indexed, against the PR head. A finding about the change as a whole has neither." },
          { name: "dimension", type: "string", note: "The id of the profile dimension it came from, such as correctness or security." },
          {
            name: "severity",
            type: "critical | warning | suggestion",
            note: "The profile's severity floor drops anything below it before it is ever reported.",
          },
          { name: "title", type: "string (max 120)", note: "One line: the claim itself." },
          { name: "detail", type: "string", note: "Why it is wrong, and what breaks because of it." },
          { name: "suggestedFix", type: "string | null", note: "Optional. Posted with the comment when there is one." },
          { name: "confidence", type: "number 0-1", note: "How sure the agent is that this is a real defect. Below 0.5 means it suspects it but could not prove it from the code it read. It is always the newest verdict's number." },
          {
            name: "status",
            type: "open | resolved | dismissed | posted",
            note: "open is untouched; posted means it is an inline comment on the pull request now; resolved means it is dealt with, and the agent closed its comment thread first if it had one; dismissed means you decided it is not a problem, which changes nothing outside the dashboard.",
          },
          { name: "threadId", type: "number | null", note: "The comment thread it became, set when it is posted. On GitHub it is the id of the review comment that starts the conversation." },
          { name: "evidence", type: "Evidence[]", note: "At least one. A finding with none is not reportable." },
          { name: "verdicts", type: "Verdict[]", note: "Its confidence history, oldest first." },
        ],
      },
      {
        name: "Evidence",
        where: "Inside a finding card",
        what: "A concrete anchor for a finding: the lines it is about, the rule it breaks, or the call sites it would take down. This is what makes a finding checkable rather than an opinion, which is why at least one is required.",
        fields: [
          {
            name: "kind",
            type: "code | rule | trace | context",
            note: "code is the changed lines themselves; rule is a project rule or spec being broken; trace is call sites or blast radius; context is anything else.",
          },
          { name: "file", type: "string?", note: "Where the cited code is, which need not be the file the finding is in." },
          { name: "lineStart / lineEnd", type: "number?", note: "The cited range." },
          { name: "snippet", type: "string?", note: "The exact code being cited, verbatim." },
          { name: "source", type: "string?", note: "The rule file, spec or document a quote comes from." },
          { name: "quote", type: "string?", note: "The exact text of the rule being applied." },
          { name: "note", type: "string?", note: "Anything else worth saying about this anchor." },
        ],
      },
      {
        name: "Verdict",
        where: "The confidence history on a finding",
        what: "One assessment of whether a finding is real. They are append-only: a challenge never erases the first read, it adds to it, and the finding's confidence becomes the newest one's.",
        fields: [
          {
            name: "by",
            type: "initial | challenge | rescan | user",
            note: "initial is written by the review pass itself, as the finding is created; challenge is a run whose job was to prove the finding wrong; rescan is a later re-check; user is a decision of yours.",
          },
          { name: "confidence", type: "number 0-1", note: "What this assessment puts it at. A challenge that finds the finding no longer valid caps it at 0.2." },
          { name: "reason", type: "string", note: "What in the code confirmed or refuted it." },
          { name: "at", type: "ISO 8601 string", note: "When it was recorded." },
        ],
      },
    ],
  },
  {
    group: "On the pull request itself",
    terms: [
      {
        name: "Thread",
        where: "The Threads tab",
        what: "A comment conversation on the pull request, read live from the host. Threads are not the dashboard's: they exist on the PR whoever wrote them, and a finding you post becomes one. Empty and deleted ones are filtered out before they reach the tab.",
        fields: [
          { name: "id", type: "number", note: "The host's thread id. This is what a posted finding stores." },
          {
            name: "status",
            type: "Azure: active | pending | fixed | wontFix | closed",
            note: "GitHub has only active and resolved, and words active as Unresolved. Dealt with means fixed, wontFix or closed on Azure DevOps, and resolved on GitHub; that is what the open/resolved filter uses.",
          },
          { name: "filePath", type: "string | null", note: "The file the thread is anchored to. Null for a comment on the pull request as a whole." },
          { name: "line", type: "number | null", note: "The line it is anchored to." },
          { name: "canSetStatus", type: "boolean?", note: "False when the host cannot change the state of this particular thread, as GitHub cannot resolve a comment left on the pull request itself. The dashboard then leaves the control out rather than offering a click that would fail." },
          { name: "outdated", type: "boolean?", note: "The lines it was written against have since changed. GitHub only." },
          { name: "comments", type: "Comment[]", note: "In order, oldest first." },
        ],
      },
      {
        name: "Comment",
        where: "Inside a thread",
        what: "One message in a thread. Azure DevOps' own system comments, the ones it writes about votes and updates, are dropped before the tab is drawn.",
        fields: [
          { name: "id", type: "number", note: "The host's comment id." },
          { name: "author", type: "string", note: "Display name, as the host gives it." },
          { name: "content", type: "string", note: "Markdown, rendered as written." },
          { name: "publishedDate", type: "ISO 8601 string", note: "When it was posted." },
          { name: "commentType", type: "string", note: "text for anything a person wrote. Azure DevOps also has system and codeChange types; system ones are filtered out." },
        ],
      },
    ],
  },
  {
    group: "What you configure",
    terms: [
      {
        name: "Profile",
        where: "Settings > Profiles; picked when a session is created",
        what: "A saved set of review criteria. It decides what is looked for, how severe a problem has to be before it is reported at all, and what the reviewer should know about the codebase before starting.",
        fields: [
          { name: "id / name", type: "string", note: "General review and Tenant isolation are built in; your own are stored in .review-tool/config/profiles.json." },
          { name: "dimensions", type: "Dimension[]", note: "What is looked for. Disabled ones are left out of the prompt entirely." },
          { name: "context", type: "string", note: "Standing context about the codebase, sent under its own heading on every review." },
          { name: "include", type: "string[]", note: "Globs. When set, only files matching them are reviewed." },
          { name: "exclude", type: "string[]", note: "Globs to ignore, such as lockfiles and snapshots." },
          { name: "useProjectRules", type: "boolean", note: "Load the reviewed project's own rule files, its CLAUDE.md and the like, as the standard to review against." },
          { name: "severityFloor", type: "critical | warning | suggestion", note: "Anything below it is not reported. suggestion reports everything; critical reports only the worst." },
          { name: "confidenceFloor", type: "number 0-1", note: "Findings below it are stored but kept out of the way. 0 keeps everything in view." },
        ],
      },
      {
        name: "Dimension",
        where: "Inside a profile",
        what: "One thing to look for, and the words that ask for it. A finding's dimension field is one of these ids, which is how a finding can be traced back to the instruction that produced it.",
        fields: [
          { name: "id", type: "string", note: "What findings from it are stamped with." },
          { name: "label", type: "string", note: "What it is called in the UI." },
          { name: "enabled", type: "boolean", note: "Off means it is not in the prompt at all, so nothing can be found for it." },
          { name: "prompt", type: "string", note: "What this dimension asks the reviewer to look for, sent verbatim." },
        ],
      },
      {
        name: "Action",
        where: "Every button that puts the agent to work; see the Actions tab",
        what: "One button and the prompt it sends. The template is the prompt: filling it in is all that happens between the click and the agent, and the confirmation shows you the result before it is sent.",
        fields: [
          { name: "id", type: "string", note: "What the button posts to the server." },
          { name: "label", type: "string", note: "The text on the button." },
          { name: "category", type: "Session | Pull request | Findings | Threads", note: "How the Actions tab groups them." },
          { name: "where", type: "string", note: "Where in the dashboard the button is, in words." },
          { name: "template", type: "string", note: "The prompt, with {placeholders}. Every one ends with {note}, so any action can be aimed by what you type in the confirmation." },
          { name: "writes", type: "boolean?", note: "True when it changes the pull request. The confirmation then warns, and the Actions tab badges it. This is separate from the agent's permission mode: Auto never means a click of yours reaches the host unconfirmed." },
          { name: "computed", type: "boolean?", note: "True when the work is the server's own, not the agent's, and is built from what is already stored. Its confirmation previews what will be posted rather than a prompt." },
          { name: "overridden", type: "boolean?", note: "True when Settings > Prompts has replaced the built-in wording. defaultTemplate keeps the original so it can be put back." },
        ],
      },
    ],
  },
  {
    group: "Underneath",
    terms: [
      {
        name: "Event",
        where: "The transcript in the chat panel",
        what: "One entry in the session's append-only log. The log is the session: the transcript, the findings list and the PR tabs are all projections of it, and it is written to SQLite and to events.jsonl under the session's folder. What the UI does not recognise it shows raw rather than dropping.",
        fields: [
          { name: "seq", type: "number", note: "Position in the session's log, from 1." },
          {
            name: "type",
            type: "session.created · session.updated · pr.attached · run.started · run.finished · run.stopped · run.error · action.started · assistant.text · tool.used · tool.blocked · permission.requested · permission.decided · chat.user · finding.created · finding.updated · thread.replied",
            note: "What happened. action.started carries the prompt that was sent, and is flagged edited when you rewrote it in the confirmation.",
          },
          { name: "payload", type: "object", note: "Shaped by the type: the finding for finding.created, the tool call for tool.used, and so on." },
          { name: "ts", type: "ISO 8601 string", note: "When it happened." },
          { name: "transient", type: "boolean?", note: "Live only: shown to open dashboards as it happens, never written to the log. Streaming text and permission prompts are like this." },
        ],
      },
      {
        name: "Run",
        where: "One turn of the agent",
        what: "Everything between a click and the agent finishing: one prompt, the tool calls it makes, and what it reported. One session runs one turn at a time, so a second action while one is in flight is refused; a chat message is the exception, and queues.",
      },
      {
        name: "Worktree",
        where: ".review-tool/temp/worktrees",
        what: "A detached git worktree the agent builds per pull request, so the diff can be read without touching your checkout or its branch. It is throwaway, and destructive git is refused outright anywhere else, in every permission mode.",
      },
      {
        name: "Provider",
        where: "Azure DevOps or GitHub",
        what: "The host a pull request lives on. Each one brings its own CLI for the agent to drive, az or gh, its own skill documenting it, its own words for the levels above a repository, and its own thread states. The dashboard only reads; every write to a pull request is the agent's, through that CLI.",
      },
    ],
  },
];

/**
 * The whole contract in one place: a developer should be able to answer "what
 * can this thing do, and what exactly does it say" without reading the source.
 */
export function InspectDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("faq");
  const [data, setData] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/inspect")
      .then((response) => response.json())
      .then((payload) => (payload.error ? setError(payload.error) : setData(payload)))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const active = TABS.find((item) => item.id === tab);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="How this tool works" maxWidth="max-w-4xl" height="h-[calc(100vh-4rem)]">
      {/* Tabs and their hint stay pinned while the panel below scrolls. */}
      <div className="sticky top-0 z-10 -mx-5 mb-3 border-b bg-card px-5 pb-2">
        <nav className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs hover:bg-muted",
                tab === item.id && "bg-muted font-medium",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {active && <p className="mt-2 text-[11px] text-muted-foreground">{active.hint}</p>}
      </div>

      <div>
        {/* The glossary is written here, not served, so it never waits. */}
        {tab !== "glossary" && error && <div className="text-xs text-destructive">{error}</div>}
        {tab !== "glossary" && !data && !error && <div className="text-xs text-muted-foreground">Loading…</div>}

        {data && tab === "actions" && (
          <div className="space-y-5">
            {/* The note is appended by the server, so it appears in no template
                below; without this the templates look like it does not exist. */}
            <p className="text-[11px] text-muted-foreground">
              These are the templates. Clicking any of them opens a confirmation showing the finished prompt, with a
              box for a note of your own: whatever you type there is appended to the template under the heading{" "}
              <code className="font-mono">## What the reviewer asked for</code>, so it reaches the agent as part of
              the same request.
            </p>
            {ACTION_GROUPS.map((group) => {
              const actions = (data.actions ?? []).filter((action) => action.category === group);
              if (!actions.length) return null;
              return (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                  <div className="space-y-2">
                    {actions.map((action) => (
                      /* The subtitle is where the button lives, so a prompt can be tied to a click. */
                      <Accordion
                        key={action.id}
                        title={action.label}
                        subtitle={action.where}
                        badge={
                          action.writes ? (
                            <StatusBadge tone="off">confirmed before it is sent</StatusBadge>
                          ) : action.computed ? (
                            <StatusBadge tone="off">built from stored data</StatusBadge>
                          ) : undefined
                        }
                      >
                        <code className="font-mono text-[11px] text-muted-foreground">{action.id}</code>
                        <PromptView className="mt-2" text={action.template} details={data.placeholders ?? {}} />
                      </Accordion>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data && tab === "tools" && (
          <div className="space-y-4">
            {/* Only the dashboard's own tools exist: the host is the agent's
                job, done with the CLI that host's skill documents. */}
            <p className="text-[11px] text-muted-foreground">
              These are the only tools the agent is given. Everything to do with the pull request itself it does
              with the host's own CLI, az or gh, following that host's skill.
            </p>
            {["dashboard"].map((server) => (
              <div key={server}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dashboard (what the agent reports back)
                </h3>
                <div className="space-y-2">
                  {(data.tools ?? [])
                    .filter((tool) => tool.server === server)
                    .map((tool) => (
                      <Accordion key={tool.name} title={tool.name} mono>
                        <p className="font-serif text-xs text-foreground/80">{tool.description}</p>
                        {tool.params.length > 0 && (
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <tbody>
                                {tool.params.map((param) => (
                                  <tr key={param.name} className="border-b border-border/50 last:border-0">
                                    <td className="py-1 pr-3 align-top font-mono">{param.name}</td>
                                    <td className="py-1 pr-3 align-top font-mono text-muted-foreground">
                                      {param.type}
                                      {param.optional ? "?" : ""}
                                    </td>
                                    <td className="py-1 align-top text-muted-foreground">{param.description ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </Accordion>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && tab === "prompts" && (
          <div className="space-y-2">
            <Accordion title="System prompt" subtitle="Appended to Claude Code's own">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">{data.prompts?.system}</pre>
            </Accordion>
            {/* One per host whose CLI is on this machine, so a developer with
                only one of them is not shown a procedure they cannot run. */}
            {(data.prompts?.skills ?? []).map((skill) => (
              <Accordion
                key={skill.name}
                title={`Skill: ${skill.name}`}
                subtitle={`The procedure it follows on every ${skill.host} PR`}
              >
                <div className="text-xs">
                  <Markdown>{skill.markdown || "_Not installed in this project._"}</Markdown>
                </div>
              </Accordion>
            ))}
            <Accordion title="Models" subtitle="One per stage, set in Settings > General">
              <dl className="grid grid-cols-3 gap-2 text-xs">
                {Object.entries(data.models ?? {}).map(([stage, model]) => (
                  <div key={stage} className="card p-2">
                    <dt className="text-[11px] capitalize text-muted-foreground">{stage}</dt>
                    <dd className="font-mono">{model}</dd>
                  </div>
                ))}
              </dl>
            </Accordion>
          </div>
        )}

        {data && tab === "permissions" && (
          <div className="space-y-3 text-xs">
            <p className="font-serif leading-relaxed text-foreground/80">
              Permissions decide what the agent may do on its own once it is working. Reading code, diffs and PR
              threads never asks. Anything that writes depends on the mode below: posting a comment, voting,
              merging, editing files, running a shell command.
            </p>
            <p className="font-serif leading-relaxed text-foreground/80">
              This is separate from the confirmation the dashboard asks for. A button that changes the pull request
              is confirmed before its prompt is sent at all, in every mode, so Auto never means a click goes
              straight to the host.
            </p>

            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current mode</div>
              <div className="mt-1 font-medium">
                {data.permissions?.mode === "auto"
                  ? "Auto: the agent's own tool calls run unattended"
                  : "Ask: each of the agent's writes is confirmed in the chat panel"}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Change it in Settings, under General, Permissions. The same place turns file edits on or off,
                which auto-fix and opening a PR need.
              </p>
            </div>

            <div className="rounded-lg bg-destructive p-3 text-destructive-foreground">
              <div className="text-[11px] uppercase tracking-wide opacity-80">Always refused</div>
              <p className="mt-1 font-serif">{data.permissions?.blockedNote}</p>
            </div>
          </div>
        )}

        {data && tab === "profiles" && (
          <div className="space-y-3 text-xs">
            <p className="font-serif leading-relaxed text-foreground/80">
              A profile is a saved set of review criteria: which dimensions the agent looks for, how severe a
              problem has to be before it is reported, and any standing context about the codebase. You pick one
              when you create a review session, and every PR in that session is reviewed against it.
            </p>
            <p className="font-serif leading-relaxed text-foreground/80">
              Use the default until it reports too much or too little. Make your own when a team or repository
              needs different criteria: security-only sweeps, a stricter floor before release, a service with
              conventions worth spelling out once.
            </p>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Where to set it</div>
              <p className="mt-1 font-serif text-foreground/80">
                Settings, under Profiles: add, rename, edit the dimensions and the severity floor.
              </p>
            </div>

            <Section title={"Configured now (" + String((data.profiles ?? []).length) + ")"}>
              <ul className="space-y-1">
                {(data.profiles ?? []).map((profile) => (
                  <li key={profile.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{profile.name}</span>
                    <StatusBadge tone="off">floor: {profile.severityFloor}</StatusBadge>
                    <span className="text-[11px] text-muted-foreground">
                      {profile.dimensions.filter((dimension) => dimension.enabled).length} dimensions on
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}

        {tab === "glossary" && (
          <div className="space-y-5">
            <p className="text-[11px] text-muted-foreground">
              The words this dashboard uses, and the record behind each one. Field names are as the API serves them,
              so what you read here is what a payload holds.
            </p>
            {GLOSSARY.map((section) => (
              <div key={section.group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.group}
                </h3>
                <div className="space-y-2">
                  {section.terms.map((term) => (
                    <Accordion key={term.name} title={term.name} subtitle={term.where}>
                      <p className="font-serif text-xs leading-relaxed text-foreground/80">{term.what}</p>
                      {term.fields && (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <tbody>
                              {term.fields.map((field) => (
                                <tr key={field.name} className="border-b border-border/50 last:border-0">
                                  <td className="py-1 pr-3 align-top font-mono">{field.name}</td>
                                  <td className="py-1 pr-3 align-top font-mono text-muted-foreground">{field.type}</td>
                                  <td className="py-1 align-top text-muted-foreground">{field.note}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Accordion>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && tab === "faq" && (
          <div className="space-y-2">
            {FAQ.map((entry) => (
              <Accordion key={entry.q} title={entry.q}>
                <p className="font-serif text-xs leading-relaxed text-foreground/80">{entry.a}</p>
              </Accordion>
            ))}
          </div>
        )}

      </div>
    </Modal>
  );
}

/**
 * A template as the agent will not quite see it: the parts assembled from the
 * profile stay as placeholders, each explaining itself on hover.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

