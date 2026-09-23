# Claude Review Hub

A local dashboard over one Claude Code session that reviews pull requests on
Azure DevOps and on GitHub. The agent does the work itself with git and the
host's own CLI, `az` or `gh`, following that host's skill; the server keeps the
record and the dashboard shows what the agent reported.

## The rule that matters: nothing is sent unseen

Every control that sends a prompt to the agent goes through **one** confirmation,
and that confirmation shows the exact prompt. This is the product, not a
nicety: the whole point of the dashboard over a bare terminal is that you can
see what is about to be asked, and change it, before it is asked.

Concretely:

- **One hook.** `useConfirm()` (`web/src/components/Confirm.tsx`) opens the one
  modal. There is no second confirmation anywhere: no inline "Sure?" buttons, no
  per-feature dialog. If a new control sends something, it calls this hook.
- **One definition of each prompt.** `ACTION_TEMPLATES` in
  `server/src/review/actions.ts` holds the template, and it *is* the prompt:
  `buildActionPrompt` only fills placeholders into it. Never write a second
  builder that assembles the same words a different way; that is how the
  dashboard and the agent drifted apart before.
- **One rendering.** `PromptView` (`web/src/components/PromptView.tsx`) draws a
  prompt, and is used by all three surfaces: the hover on a button, the
  confirmation, and the Actions tab of "How this tool works". The label they
  share is `PROMPT_LABEL`.
- **One source for what is displayed.** The hover and the modal both call
  `GET /sessions/:id/actions/:actionId/preview`, which is `buildActionPreview`:
  the same prompt, in reading form. Values longer than a line stay as their
  `{placeholder}` and travel in `values`, so the UI shows them on hover instead
  of pasting a page of JSON into the middle of a sentence. The agent still
  receives the filled-in version. The client never fills a template itself.
- **A note always fits.** Every template ends with `{note}`, which expands to a
  `## What the reviewer asked for` section or to nothing. The confirmation's note
  box is how the reviewer aims a request, so no action should be without one.
- **The templates themselves can be rewritten.** Settings > Prompts lists every
  action and lets one be replaced for good, stored in
  `.review-tool/config/prompts.json`. Nothing reads `action.template` directly:
  everything goes through `templateOf()`, so an override reaches the hover, the
  confirmation, "How this tool works" and the agent together. `effectiveActions()`
  is what `/actions` and `/inspect` serve, with `defaultTemplate` kept so the
  built-in wording can be restored.
- **The prompt can be rewritten for one request.** The confirmation has an Edit control beside
  the label: it opens the prompt in a textarea, starting from the **full** text
  rather than the reading form, since a `{placeholder}` sent literally would mean
  nothing to the agent. The rewrite goes to `runAction` as `prompt` and is sent
  as written, flagged `edited` on the `action.started` event. A template is a
  starting point, not a cage.

The two deliberate exceptions, both because the user is already looking at the
exact text they are sending:

- The chat box. What you type is what is sent, and it appears in the transcript.
- Work the server does itself rather than the agent, such as posting a reply to
  a thread. It still goes through the same modal, but the preview shows the
  comment that will be posted, not a prompt.

Controls that change nothing outside the dashboard use the same modal, with no
note box and no preview: Dismiss on a finding, and Delete on a session. Resolve
is not one of them, because a finding that was posted has a comment thread on the
pull request that should close with it, and only the agent can do that.

## Auto detect settles the criteria per pull request

The profile picker has one entry that is not a profile. `Auto detect`
(`AUTO_PROFILE_ID`) says the criteria are decided per pull request instead of
once for the session, and it is the only thing in the tool that runs a review
as two turns:

1. `review.prepare` resolves and registers the pull requests, and reviews
   nothing. It is confirmed like any other prompt.
2. `profiles.suggest` goes to a Claude of its own - no tools, no worktree,
   nothing of the session in front of it - with every profile by id, name and
   context, and the pull requests as they were registered.
3. The modal in `AutoProfiles.tsx` shows a row per pull request and will not
   close by clicking away. A row may end with no profile, and then its note is
   the whole brief, which is why one of the two is always required.
4. `review.auto` is confirmed last, with one brief per pull request built from
   what that modal settled and stored on `session_prs.profile_id` /
   `review_note`.

Nothing above runs unless the picker is on Auto detect. Every other way of
starting a review is the single `review` turn it has always been.

## No profile is a prompt, not an empty profile

`No profile` (`NO_PROFILE_ID`) is the picker's other entry that is not a
profile: no dimensions, no standing context, no severity floor. It does not
send the review prompt with its sections left blank - it sends the criteria-free
twin of it, `review.none` or `pr.review.none`, so what the confirmation shows is
a whole prompt rather than one full of holes. The note is the entire brief
there, so the confirmation will not send without it. It is offered wherever a
review is started: the sidebar, Add PRs, Review all and Re-review.

## Every review picks its criteria in its own confirmation

Add PRs, Review all and the PR toolbar's Review / Re-review all carry
`chooseProfile`, so the profile and `ReviewDepth` are settled beside the prompt
that is about to be sent. A re-review is a review: it is given the same
dimensions, context, filters and severity floor as one of the session.

## How hard to look is a setting, not a profile

A profile says *what* to look for. `settings.review` - the project's own rule
files, one agent per dimension, the verify pass - says how much machinery to
spend looking, which is a decision about cost, so it is made once for the tool.
`ReviewDepth` is the one definition of those three controls and is shown
wherever a review is about to start: Settings > General, the sidebar's Advanced
block, and the confirmation beside the profile picker.

## Writes to the pull request are marked

An action that changes the pull request sets `writes: true` on its template. The
modal then shows a warning naming the host, and the Actions tab badges it. This
is separate from the agent's own permission mode: `Auto` decides what the agent
may do once it is working, never whether a click of yours reaches the host.

## One provider abstraction, no host names scattered about

`server/src/providers/` holds everything host-shaped: the CLI to drive, the
skill that documents it, the words for the levels above a repository, the thread
states, the pull request URL, and the three reads the server performs itself
(`getThreads`, `replyToThread`, `currentUser`). Everything else asks a
`Provider` rather than branching on a name.

- **A pull request carries its own host.** `session_prs.provider` is set when
  the agent registers it, and `prRef()` passes it on. Nothing infers the host
  from the session, because one session can hold pull requests from both.
- **The repo decides, not the CLIs.** `detectContext()` reads the origin remote
  first, so a machine with both `az` and `gh` is never ambiguous. Only when the
  remote names neither host does the remembered one, then the CLI defaults,
  decide.
- **Both are always listed.** `/health` and `/connections` return every host
  with `installed`, `signedIn` and its account, so the sidebar can be honest
  about a machine with one CLI and about one with two.
- **The words come from the host.** The thread dropdown, the open/resolved
  filter, the confirmation warning and every prompt that names a CLI are built
  from the provider, never hardcoded. In the web that goes through
  `useHost()` / `useHostName()` (`web/src/lib/providers.ts`); on the server
  through `providerFor()`.
- **Adding a host** means one file under `server/src/providers/`, one entry in
  `PROVIDER_KINDS`, one skill folder under `skill/`, and one fallback entry in
  `web/src/lib/providers.ts`. Nothing else should need touching.

## The configuration can live once for the machine

The tool is installed per project, so `.review-tool/config` is per project too.
`server/src/globalConfig.ts` keeps the same document once for the machine, at
`~/.claude-review-hub/settings.json`, and it *is* the export file: one format in
two places, so `buildBackup` and `applyBackup` stay the only two
implementations. Settings > Backup syncs in both directions, each through the
one confirmation, and a section that is not being written stays as it was in the
global copy rather than being dropped.

The first start in a project offers it in the terminal
(`scripts/offer-global.mjs`), before the server starts and before the profiles
question, and only when a global copy exists. The answer is remembered in
`.review-tool/config/global.json`, whichever way it went.

## When the agent asks, rather than asks to act

`canUseTool` carries two different things, and they are drawn differently.
Asking to *do* something is a permission: the Approve / Deny card, and `auto`
answers it. `AskUserQuestion` is the agent asking the reviewer something, so it
is not a permission and `auto` has no say in it - auto is a licence to act,
never a licence to answer in their name. `askQuestions`
(`server/src/permissions.ts`) parks the turn on a `question.asked` event and
`QuestionCard` draws the options as Claude Code would, with each option's
description, its preview, and a free-text row the tool itself does not offer.
The answer goes back as `answers` written into the tool's own input, keyed by
the question, which is what the CLI turns into the tool result. Skipping is
always available: a parked turn is worse than a question left to the agent.

## No outlined UI

This project does not use outlined/bordered UI elements for emphasis (warnings,
badges, cards, etc.). Use a filled background color instead of a border. If you
see a border added for that purpose, remove it.

## One turn at a time

`isRunning(sessionId)` gates it. The server answers `409` to a second action
while one is in flight, and `useAgentBusy()` disables the buttons that would
start one. The chat box is exempt: a message typed mid-turn is meant to queue.

## Running it

`npx "C:/Source code/project-review" <repo>` runs the built output (published as `claude-review-hub`). While working
on the tool itself use `npm run dev -- <repo>`, which runs the sources with hot
reload. See README.md.
