---
name: azure-pr-master
description: Use when working with Azure DevOps Pull Requests — fetching PR list, loading full diffs, splitting diffs into per-file markdown in a diffs/ folder, reading existing PR threads/comments, or posting inline and general comments via az CLI and git.
---

# Azure PR Master

## Overview

Complete workflow for interacting with Azure DevOps PRs: list PRs, load full diff, split into per-file `diffs/` folder, fetch existing comment threads, post general and inline comments — entirely via `az` CLI + `git`. No external tools required.

## Rule: Resolve the Repo Yourself, Then Work in a Detached Worktree

Before fetching diffs, reading threads, posting comments, or doing anything else with a PR:

1. **Resolve the local repo path yourself.** Never ask the user where a repo is. The PR gives you a repo
   name; look for a sibling directory of the project you were started in whose `.git/config` remote points
   at that repo. If none matches, clone it yourself:
   ```bash
   git clone --bare https://dev.azure.com/{org}/{project}/_git/{repo} \
     .review-tool/temp/repos/{repo}.git
   ```
2. Identify the **source branch** from PR metadata (`sourceRefName`, strip `refs/heads/`).
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

## Rule: Tell the Dashboard This Is an Azure DevOps PR

When you call `mcp__dashboard__register_pr`, pass `provider: "azure"`, `org` as the organisation and
`project` as the team project. Every button about that pull request then names `az` rather than `gh`,
and its link points at dev.azure.com.

---

## Prerequisites

```bash
# Install Azure DevOps extension
az extension add --name azure-devops

# Authenticate
az login
az devops configure --defaults organization=https://dev.azure.com/{org} project={project}

# Verify
az account show
az repos pr list --output table
```

**Detect org/project from remote URL:**
```bash
git remote get-url origin
# https://dev.azure.com/{org}/{project}/_git/{repo}
# https://{org}.visualstudio.com/{project}/_git/{repo}
```

---

## List Open PRs

```bash
az repos pr list \
  --repository {repo} \
  --project {project} \
  --org https://dev.azure.com/{org} \
  --status active \
  --output table
```

---

## Fetch PR Metadata

```bash
az repos pr show --id {pr_number} --org https://dev.azure.com/{org} --output json
```

> **Do NOT add `--project`** — `az repos pr show` does not accept it and will error with "unrecognized arguments". PR IDs are unique per org, project is not needed.

Extract from JSON:
- `sourceRefName` → strip `refs/heads/` → **`target_branch`**
- `targetRefName` → strip `refs/heads/` → **`base_branch`**
- `lastMergeSourceCommit.commitId` → **`commit_sha`**

---

## Load Full Diff + Split into diffs/ Folder

Use the bundled `split-diff.mjs` script — fetches diff, creates session folder, and splits into per-file `.md`:

```bash
node {skill_dir}/split-diff.mjs \
  --repo   "C:/path/to/local/repo" \
  --base   {base_branch} \
  --target {target_branch} \
  --pr     {pr_number} \
  --output "C:/path/to/output"        # optional, default: ./azure-pr-master-output
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

**Per-file format:**
```markdown
# src/auth/login.ts
**Status:** modified | **+45 / -12 lines**
---

**Lines 67–70**
```diff
- async function login(user, pass) {
+ async function login(user: string, pass: string): Promise<User> {
```
```

**Status rules:**

| File state | Status label | Hunk content |
|------------|-------------|--------------|
| New file | `added` | All lines as `+` |
| Deleted file | `deleted` | All lines as `-` |
| Renamed, no changes | `renamed` | Status line only, no hunks |
| Renamed + changes | `renamed` | Status line + hunks |
| Modified | `modified` | Changed hunks only |

---

## Fetch Existing PR Threads/Comments

> **Note:** `az repos pr thread` and `az repos pr comment` subcommands do NOT exist in azure-devops extension v1.0.2. Use the REST API via `Invoke-RestMethod` (PowerShell) instead.

```powershell
# Get Bearer token (resource GUID = Azure DevOps)
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

# Fetch all threads
$response = Invoke-RestMethod `
  -Uri "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr_number}/threads?api-version=7.1" `
  -Headers $headers -Method GET

# Save to file
$response | ConvertTo-Json -Depth 10 | Out-File "threads.json" -Encoding utf8
Write-Output "Thread count: $($response.count)"
```

Each thread object contains:
- `comments[].content` — comment text (skip `commentType == "system"`)
- `comments[].author.displayName` — author name
- `threadContext.filePath` — file path (inline threads only, `$null` for general)
- `threadContext.rightFileStart.line` — line number for inline threads
- `status` — `active`, `resolved`, `closed`

---

## Post General Comment

```powershell
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$body = @{
  comments = @(@{ parentCommentId = 0; content = "Your comment text here"; commentType = 1 })
  status = "active"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr_number}/threads?api-version=7.1" `
  -Headers $headers -Method POST -Body $body
```

---

## Post Inline Comment (file + line)

```powershell
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$body = @{
  comments = @(@{ parentCommentId = 0; content = "Issue found here"; commentType = 1 })
  threadContext = @{
    filePath = "/src/auth/login.ts"       # leading slash required
    rightFileStart = @{ line = 42; offset = 1 }
    rightFileEnd   = @{ line = 42; offset = 1 }
  }
  status = "active"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr_number}/threads?api-version=7.1" `
  -Headers $headers -Method POST -Body $body
```

> **Note:** `filePath` requires a leading `/` — e.g. `/src/auth/login.ts` not `src/auth/login.ts`.

**Verify:**
```powershell
$r = Invoke-RestMethod -Uri "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr_number}/threads?api-version=7.1" -Headers $headers -Method GET
Write-Output "Thread count: $($r.count)"
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
    └── threads.json          # fetched via REST API (Invoke-RestMethod)
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
| `az repos` command not found | Run `az extension add --name azure-devops` |
| "unrecognized arguments: --project" on `pr show` | Remove `--project` — `az repos pr show` only accepts `--id` and `--org` |
| `az repos pr thread` / `az repos pr comment` not found | These subcommands don't exist in extension v1.0.2 — use `Invoke-RestMethod` with REST API instead (see sections above) |
| `Invoke-RestMethod` returns 401/403 | Run `az login` first; token resource must be `499b84ac-1321-427f-aa17-267ca6975798` (Azure DevOps GUID) |
| `az rest` encoding error on Windows (`charmap codec`) | Don't use `az rest` for PR threads — use `Invoke-RestMethod` which handles UTF-8 correctly |
| `filePath` in inline thread missing leading `/` | Use `/src/file.ts`, not `src/file.ts` |
| Empty `full.diff` | Run `git fetch origin --prune` first, and use `origin/` prefix in `git diff` |
| `git diff` fails "unknown revision" | Branch doesn't exist locally — use `origin/{branch}` not `{branch}` |
| Diff parsed incorrectly on Windows | Strip `\r` from each line: `.split('\n').map(l => l.replace(/\r$/, ''))` |
| Thread not appearing after post | Wait a few seconds and re-fetch via REST API to verify |
