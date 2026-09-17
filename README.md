<div align="center">

<img src="logo.svg" alt="" width="120" height="75" />

# Claude Review Hub

**Pull request review that actually reads the code, in a dashboard you control.**

[![npm](https://img.shields.io/npm/v/claude-review-hub?color=d77757)](https://www.npmjs.com/package/claude-review-hub)
[![license](https://img.shields.io/badge/license-MIT-d77757)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-d77757)](https://nodejs.org)

</div>

> **Not a replacement for Claude Code — a window onto it.** Every review is a
> real `claude` session, resumable anytime from your own terminal
> (`claude --resume <id>`, shown right in the sidebar). Your project's own
> `CLAUDE.md`, skills, MCP tools and permission rules stay exactly as they are;
> this only adds two skills of its own alongside them.

Point it at a repo, paste a PR number, and Claude Code reviews it the way a
senior engineer would: it clones the branch into a worktree, reads the diff
against the real codebase, and comes back with findings that cite evidence.
You decide what gets posted.

```console
$ npx claude-review-hub "C:/Source code/your-repo"

  ✳️  Claude Review Hub
  project : C:/Source code/your-repo
  skill   : azure-pr-master installed
  skill   : github-pr-master installed
  host    : Azure DevOps
  org     : your-org
  url     : http://localhost:4319

  Keep this terminal open. Press Ctrl+C to stop the dashboard.
```

---

## 🎬 See it review a real pull request

![Claude Review Hub demo](https://raw.githubusercontent.com/goldynlabs/claude-review-hub/main/assets/rocket-chat-review-demo.gif)

*This is a demo recording — the finding shown (prefixed `[DEMO]`) is illustrative, not a real defect.*

---

## 😵 The problem

Reviewing a pull request properly is expensive, so it mostly does not happen.

- **The diff lies.** A three-line change is safe or catastrophic depending on
  who calls it, and the PR page will not tell you which. Finding out means
  checking out the branch and grepping the repo.
- **Bot reviewers are noise.** They read the diff and nothing else, so they
  flag style and miss the tenant id that stopped being filtered. After a week
  of that, nobody reads their comments.
- **The terminal is not a record.** You can ask an agent to review a PR in a
  chat window today, but tomorrow the session is gone, the reasoning is gone,
  and nothing connects what it said to what you posted.
- **You cannot trust what you cannot see.** An agent with write access to your
  pull requests is a liability unless you know the exact words it is about to
  send, before it sends them.

## ✨ What Claude Review Hub does about it

**It reads the repository, not just the patch.** Every PR gets a detached git
worktree of the actual branch. Claude opens the files, follows the call sites,
and reads your `CLAUDE.md` and conventions, because the tool installs into your
project and runs from its root.

**Findings come with evidence and a confidence score.** Not "consider
refactoring this". A finding names the file and line, states the input or state
that produces the wrong result, and cites what it checked.

**You can argue with it.** Disagree with a finding? Hit **Challenge**, type
your counter-argument, and an adversarial re-check runs against it. The new
verdict is appended, never overwritten, so the disagreement stays on the
record.

**Nothing is sent unseen.** Every control that sends a prompt to the agent
opens one confirmation showing the exact prompt, with a note box to aim it and
an Edit control to rewrite it for that one request. Anything that writes to the
pull request is marked before you click.

**It stays yours.** Sessions, findings, verdicts and the full event log live in
the repo you reviewed. Nothing to host, no extra account, no analytics: the
dashboard runs on localhost for as long as your terminal is open, and the only
thing that leaves the machine is what Claude Code and your own CLIs already
send.

**It's a lens, not a lock-in.** Every session is a real Claude Code session;
resume it anytime with `claude --resume <id>`, shown in the sidebar. Your
project's own `CLAUDE.md`, skills, MCP servers and permission rules keep
working exactly as before — this only adds two skills alongside them.

---

## ⚡ Quick start

```bash
# From inside the repo you want to review
cd your-repo
npx claude-review-hub

# Or point it at one
npx claude-review-hub "C:/Source code/your-repo"
```

That single command installs the review skills into the project, hides the
tool's own files from git through `.git/info/exclude` (your `.gitignore` is
never touched, so the repo shows no modified file), and opens the dashboard on
<http://localhost:4319>.

It is idempotent. Run it again after an update and it refreshes the skills in
place. Running it in a second repo does not clash: a port already in use is
skipped and the banner names the one it took.

### 🧰 Requirements

| | |
|---|---|
| Node | 20 or newer |
| Claude Code | Signed in on this machine, with a plan that allows Sonnet and Opus |
| Azure DevOps | `az login`, plus `az extension add --name azure-devops` |
| GitHub | `gh auth login` |
| Repos | A local checkout of every repository whose PRs you review |

Install only the CLI for the host you use. Which host a repo is on is read from
its git remote, so having both CLIs is never ambiguous: the sidebar names the
host in play, and every button about a pull request drives that host's CLI.
With one CLI installed the dashboard shows one account and the agent is told
about one host; the other is listed as not installed rather than as broken.

---

## 🔁 The loop

```
  paste PR ids  →  worktree + diff  →  findings
                                      ↓
  post / reply / approve   ←   challenge

  the chat box reaches every one of those steps
```

**1. Start a session.** The PR box is free text. Ids, full URLs, or a sentence:
`4821 4830 focus on the migration path`. Anything that is not a PR id
becomes context for the run. One session can span several PRs and several
repositories.

**2. Pick what "review" means.** Criteria are configured in the tool, not
buried in a prompt file. A **profile** holds review dimensions (correctness,
security, blast radius, project rules, or your own), extra context, include and
exclude globs, and a severity floor. The shipped profiles are a starting point;
Settings is where you make them yours.

**3. Read the findings.** Each one carries severity, confidence, file and line,
and the evidence behind it. Dismiss what you do not want. Challenge what you
doubt.

**4. Act on the PR.** Post a single finding or all of them, reply to a thread,
set a thread's state, approve, reject, wait for the author, or merge. Every one
of those opens the confirmation first.

**5. Ask for anything else.** The chat box drives the same operations the
buttons do, in the same session, landing in the same event log. The buttons are
the shortcuts; the chat box is the whole surface.

Existing PR comments are deliberately **not** fed into the review pass, so the
first read is unbiased. They enter Claude's context only when you reply to a
thread or ask about one.

---

## 🔧 Under the hood

The dashboard is not a wrapper around a chatbot. The server keeps the record;
the agent does the work with your own CLIs.

- **A detached worktree per PR**, built from the local checkout you already
  have. Nothing is downloaded twice, and your working tree is never touched.
- **The server produces the diff**, splits it per file, and hands it over.
  Claude spends its context reading code, not reconstructing patches.
- **One definition of every operation.** A reply typed in chat and one clicked
  on a thread card are the same function call, and both land in the append-only
  event log that the UI is drawn from. Close the browser mid-review and reopen
  it: the session is exactly where you left it.
- **Prompt templates are editable for good.** Settings > Prompts lists every
  action and lets its wording be replaced, which reaches the hover preview, the
  confirmation, the docs tab and the agent together. The built-in wording can
  always be restored.
- **Every session is a real `claude` session.** `claude --resume <id>`, printed
  in the sidebar, drops you into the same session with the same history — the
  dashboard just watches and drives it.

## ⌨️ Commands

| Command | What it does |
|---|---|
| `npx claude-review-hub` | Install what the repo needs, then open the dashboard |
| `npx claude-review-hub <repo>` | Same, for a repo other than the current directory |
| `npx claude-review-hub install` | Only install the skills and the git exclude entries |
| `npx claude-review-hub --port 4320` | Prefer a specific port |
| `npx claude-review-hub uninstall` | Remove the skills and the git exclude entries |
| `npx claude-review-hub uninstall --purge` | Also delete `.review-tool/`: sessions, findings and worktrees |

`Ctrl+C` stops the dashboard, and closing the terminal stops it too.

### 📁 What it writes to your project

```
<project>/
  .claude/skills/azure-pr-master/     the Azure DevOps procedure, refreshed on start
  .claude/skills/github-pr-master/    the GitHub procedure, refreshed on start
  .review-tool/                       hidden from git, never committed
    config/settings.json
    config/profiles.json              your review criteria
    config/prompts.json               your prompt overrides
    data/review.db                    sessions, PRs, findings, evidence, verdicts
    data/sessions/<id>/events.jsonl   append-only log, the UI's source of truth
    temp/worktrees/<repo>-pr<id>/
    temp/diffs/<repo>-pr<id>/
```

Everything lives in the repo it reviewed, so nothing is lost when npm clears
its npx cache. That's also the entire footprint — nothing else in the project
is touched.

---

## ⚙️ Settings worth knowing

| Setting | Default | Why |
|---|---|---|
| `allowCodeEdits` | off | Review is read-only. Turn it on for auto-fix or opening a PR |
| `permissionMode` | auto | `ask` confirms every write and shell command the agent attempts. Separate from your own clicks, which are always confirmed |
| `models` | Sonnet to review, Opus to challenge and chat | The broad sweep is wide, the adversarial pass is hard |
| `worktreeTtlHours` | 72 | Worktrees stay browsable, then are pruned on start |
| `sessionLanguage` | en | What Claude writes into the dashboard. The prompts it is sent stay English |
| `pullRequestLanguage` | en | What Claude writes into the pull request |

---

## 🛠️ Working on the tool

`npx` runs the built output, so a source change only reaches it after a
rebuild. To run the sources instead, against a real repo:

```bash
git clone https://github.com/goldynlabs/claude-review-hub
cd claude-review-hub
npm install
npm run dev -- "C:/Source code/your-repo"   # the repo is remembered
npm run dev                                 # later runs reuse it
```

`server/` and `web/` reload on save. `skill/` needs a restart, because a
project gets its copy of the skills at start-up. Ports are chosen at start-up
and printed, so several instances can run at once. `npm run typecheck` before
opening a PR.

## 📄 License

MIT. See [LICENSE](LICENSE).
