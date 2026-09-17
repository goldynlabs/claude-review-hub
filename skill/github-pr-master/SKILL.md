---
name: github-pr-master
description: Use when working with GitHub Pull Requests — fetching PR list, loading full diffs, splitting diffs into per-file markdown in a diffs/ folder, reading existing review threads/comments, resolving conversations, voting, or posting inline and general comments via the gh CLI and git.
---

# GitHub PR Master

## Overview

Complete workflow for interacting with GitHub PRs: list PRs, load full diff, split into per-file `diffs/` folder, fetch existing review threads, resolve conversations, post general and inline comments — entirely via `gh` CLI + `git`. No external tools required.

## Rule: Resolve the Repo Yourself, Then Work in a Detached Worktree

Before fetching diffs, reading threads, posting comments, or doing anything else with a PR:

1. **Resolve the local repo path yourself.** Never ask the user where a repo is. The PR gives you a repo
   name; look for a sibling directory of the project you were started in whose `.git/config` remote points
   at that repo. If none matches, clone it yourself:
   ```bash
   git clone --bare https://github.com/{owner}/{repo}.git \
     .review-tool/temp/repos/{repo}.git
   ```
2. Identify the **source branch** from PR metadata (`headRefName`).
3. Fetch it and add a **detached worktree** under the tool's own temp folder. Use that path for every
   later step, including `--repo` for `split-diff.mjs`:
   ```bash
   git -C {repo_path} fetch origin {source_branch} --quiet
   git -C {repo_path} worktree add --detach \
     .review-tool/temp/worktrees/pr-{pr_number} FETCH_HEAD
   ```

> **Why:** never touch the developer's working tree. `checkout`, `reset` and `clean` against the main
> checkout are refused outright by the dashboard, in every permission mode. A worktree gives you the
> source branch on disk without moving anything the developer has open, so no confirmation is needed
> and nothing of theirs is at risk.

## Rule: Tell the Dashboard This Is a GitHub PR

When you call `mcp__dashboard__register_pr`, pass `provider: "github"`, `org` as the **owner**, and leave
`project` out — GitHub has no level between the owner and the repository. Every button about that pull
request then names `gh` rather than `az`, and its link points at github.com.

---

## Prerequisites

```bash
# Authenticate (once per machine)
gh auth login

# Verify
gh auth status
gh pr list
```

**Detect owner/repo from remote URL:**
```bash
git remote get-url origin
# https://github.com/{owner}/{repo}.git
# git@github.com:{owner}/{repo}.git
```

> PR numbers are **per repository** on GitHub, not per organisation. A bare number means nothing without
> an owner and a repo, so always resolve those first: from the remote, from the PR URL, or with
> `--repo {owner}/{repo}` on every `gh` call.

---

## List Open PRs

```bash
gh pr list --repo {owner}/{repo} --state open --limit 50 \
  --json number,title,author,headRefName,baseRefName,isDraft
```

---

## Fetch PR Metadata

```bash
gh pr view {pr_number} --repo {owner}/{repo} \
  --json number,title,body,author,state,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,url
```

Extract from JSON:
- `headRefName` → **`target_branch`** (the branch under review)
- `baseRefName` → **`base_branch`**
- `headRefOid` → **`commit_sha`** (needed for every inline comment)

---

## Load Full Diff + Split into diffs/ Folder

Use the bundled `split-diff.mjs` script — fetches diff, creates session folder, and splits into per-file `.md`:

```bash
node {skill_dir}/split-diff.mjs \
  --repo   "C:/path/to/local/repo" \
  --base   {base_branch} \
  --target {target_branch} \
  --pr     {pr_number} \
  --output "C:/path/to/output"        # optional
```

**Output structure:**
```
{output}/
└── YYYY-MM-DD-HHmm-pr{number}-{branch}/
    ├── full.diff
    └── diffs/
        ├── src/auth/login.ts.md
        └── package.json.md
```

`gh pr diff {pr_number}` gives the same diff in one piece when you only want to read it.

---

## Fetch Existing Review Threads/Comments

GitHub keeps two things apart, and a review needs both:

- **Review threads** — inline conversations on lines of the diff. These resolve.
- **Issue comments** — comments on the pull request as a whole. These do **not** resolve.

> **Whether a conversation is resolved is not in the REST API at all.** `gh api repos/.../pulls/{n}/comments`
> returns a flat list of comments with no resolution state and no thread grouping. Use GraphQL for the
> inline threads.

```bash
gh api graphql -f query='
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first:100) {
            nodes { databaseId author { login } body createdAt }
          }
        }
      }
    }
  }
}' -f owner={owner} -f name={repo} -F number={pr_number}
```

- `nodes[].id` — the **thread node id** (a string like `PRRT_kw...`). Only GraphQL accepts it, and only it
  can resolve a conversation.
- `nodes[].comments.nodes[0].databaseId` — the **root comment id** (a number). This is the thread id the
  dashboard uses, and what a reply is addressed to.

Comments on the pull request itself:
```bash
gh api repos/{owner}/{repo}/issues/{pr_number}/comments --paginate
```

---

## Post General Comment

```bash
gh pr comment {pr_number} --repo {owner}/{repo} --body-file comment.md
```

Write the body to a file first when it has line breaks or backticks; `--body` on one line mangles both.

---

## Post Inline Comment (file + line)

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -f body="Issue found here" \
  -f commit_id="{head_sha}" \
  -f path="src/auth/login.ts" \
  -F line=42 \
  -f side=RIGHT
```

- `path` takes **no leading slash** — `src/auth/login.ts`, not `/src/auth/login.ts`. This is the opposite
  of Azure DevOps.
- `commit_id` must be the PR's **head** SHA (`headRefOid`), or the call is rejected.
- For a range, add `-F start_line={first}` and `-f start_side=RIGHT`.
- The response's `id` is the thread id to hand back to `mcp__dashboard__mark_finding_posted`.

**Verify:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments --jq 'length'
```

---

## Reply to a Thread

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{root_comment_id}/replies \
  -f body="Fixed in the follow-up commit, thanks."
```

A comment on the pull request itself cannot be replied to inline: answer it with another
`gh pr comment`.

---

## Resolve / Unresolve a Conversation

Only GraphQL can do this, and it needs the **thread node id** from the query above, not the comment id.

```bash
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}' -f threadId={thread_node_id}
```

Unresolve is the same with `unresolveReviewThread`.

> To go from the numeric thread id the dashboard shows to the node id, run the `reviewThreads` query and
> match on `comments.nodes[0].databaseId`.

---

## Vote on a PR

```bash
gh pr review {pr_number} --repo {owner}/{repo} --approve                --body "Looks good."
gh pr review {pr_number} --repo {owner}/{repo} --request-changes        --body "See the inline comments."
gh pr review {pr_number} --repo {owner}/{repo} --comment               --body "Notes, not a block."
```

GitHub has three review states, not Azure DevOps' five vote numbers. You cannot approve your own pull
request; `gh` fails with "Can not approve your own pull request".

---

## Create a PR

```bash
gh pr create --repo {owner}/{repo} \
  --base {base_branch} --head {source_branch} \
  --title "..." --body-file description.md --draft
```

## Complete a PR

```bash
gh pr merge {pr_number} --repo {owner}/{repo} --squash --delete-branch
```

---

## Session Folder Structure

```
_prr-output/reviews/
└── 2026-03-02-1430-pr44-feature-auth/
    ├── full.diff
    ├── diffs/
    │   ├── src/
    │   │   └── auth/
    │   │       └── login.ts.md
    │   └── package.json.md
    └── threads.json          # fetched via gh api graphql
```

**Session slug computation:**
```
branch  = target_branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
slug    = "pr{pr_number}-{branch}"
prefix  = "YYYY-MM-DD-HHmm"
session = "{review_output}/{prefix}-{slug}"
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `gh: command not found` | Install the GitHub CLI, then `gh auth login` |
| 401 / 404 on a repo that exists | `gh auth status`; the token may lack `repo` scope. `gh auth refresh -s repo` |
| Bare PR number resolves to the wrong repo | PR numbers are per repository on GitHub. Always pass `--repo {owner}/{repo}` |
| Thread resolution state missing | REST does not have it. Use the `reviewThreads` GraphQL query |
| `resolveReviewThread` says the id is invalid | You passed the comment `databaseId`. It needs the thread's node `id` |
| Inline comment 422 "path is invalid" | Drop the leading slash: `src/file.ts`, not `/src/file.ts` |
| Inline comment 422 "commit_id is invalid" | Use the PR's `headRefOid`, not the base or a local SHA |
| `-f line=42` sends a string | Use `-F line=42`; `-F` sends it as a number, `-f` as a string |
| Multi-line comment body mangled | Write it to a file and use `--body-file`, not `--body` |
| Empty `full.diff` | Run `git fetch origin --prune` first, and use `origin/` prefix in `git diff` |
| `git diff` fails "unknown revision" | Branch does not exist locally — use `origin/{branch}` not `{branch}` |
| Diff parsed incorrectly on Windows | Strip `\r` from each line: `.split('\n').map(l => l.replace(/\r$/, ''))` |
