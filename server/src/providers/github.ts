import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Account, Provider, PullRequestRef, RepoAccess, RepoCoordinates, Thread } from "./types.js";

const exec = promisify(execFile);

let cachedToken: { value: string; expiresAt: number } | null = null;

export class GitHubAuthError extends Error {}

/**
 * Auth piggybacks on the developer's own `gh auth login`, exactly as Azure
 * piggybacks on `az login`: no token is ever typed into this tool or stored by it.
 */
async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  try {
    const { stdout } = await exec("gh", ["auth", "token"], { shell: true, windowsHide: true });
    const token = stdout.trim();
    if (!token) throw new Error("gh returned no token");
    // gh hands out a long-lived token; re-asking every half hour is only to
    // notice a logout rather than to beat an expiry.
    cachedToken = { value: token, expiresAt: Date.now() + 30 * 60_000 };
    return token;
  } catch (error) {
    throw new GitHubAuthError(
      `Could not get a GitHub token. Run 'gh auth login' first. (${(error as Error).message})`,
    );
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

/** Every GitHub REST call goes through here, so failures read the same way. */
async function githubRequest<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const response = await fetch(`https://api.github.com/${pathname.replace(/^\//, "")}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status} on /${pathname}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Whether a conversation is resolved is not in the REST API at all, so the
 * inline threads are read through GraphQL. It is also the only call that hands
 * back a thread as a thread, rather than a flat list of comments to regroup.
 */
async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new Error(`GitHub GraphQL: ${payload.errors.map((e) => e.message).join("; ")}`);
  return payload.data as T;
}

const REVIEW_THREADS = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 100) {
            nodes { databaseId author { login } body createdAt }
          }
        }
      }
    }
  }
}`;

/**
 * Parses the shapes a GitHub remote comes in:
 *   https://github.com/{owner}/{repo}
 *   https://{user}@github.com/{owner}/{repo}
 *   git@github.com:{owner}/{repo}
 *   ssh://git@github.com/{owner}/{repo}
 * GitHub has no project level, so that field stays empty everywhere.
 */
export function parseGitHubRemote(url: string): RepoCoordinates | null {
  const cleaned = url.trim().replace(/\.git$/, "");

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+)$/.exec(cleaned);
  if (ssh) return { org: ssh[1], project: "", repo: ssh[2] };

  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/.exec(cleaned);
  if (https) return { org: https[1], project: "", repo: https[2] };

  return null;
}

let cachedUser: Account | null = null;

export const github: Provider = {
  kind: "github",
  label: "GitHub",
  cli: "gh",
  skill: "github-pr-master",
  signInHint: "gh auth login",
  orgLabel: "Owner",
  // GitHub has no level between the owner and the repository, so the row that
  // would show one is left out rather than shown empty.
  projectLabel: "",
  // GitHub resolves a conversation or it does not; there is no third state.
  threadStates: [
    { value: "active", label: "Unresolved" },
    { value: "resolved", label: "Resolved" },
  ],
  resolvedStates: ["resolved"],
  closeThreadPhrase: "Resolve that conversation",

  parseRemote: parseGitHubRemote,

  prUrl: (ref) => `https://github.com/${ref.org}/${ref.repo}/pull/${ref.prId}`,

  async cliInstalled() {
    try {
      await exec("gh", ["--version"], { shell: true, windowsHide: true });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * gh keeps no default owner the way `az devops configure` keeps one, so the
   * only sensible fallback is the account itself: its own repositories are the
   * ones a bare repo name is most likely to mean.
   */
  async cliDefaults() {
    try {
      const user = await github.currentUser();
      return user.id ? { org: user.id, project: "", repo: "" } : null;
    } catch {
      return null;
    }
  },

  /** Who the `gh` token belongs to. One account per host, so `org` is not used. */
  async currentUser(): Promise<Account> {
    if (cachedUser) return cachedUser;
    const raw = await githubRequest<any>("user");
    cachedUser = {
      // The login, not the numeric id: it is what a comment is attributed to.
      id: raw.login,
      displayName: raw.name || raw.login || "unknown",
      email: raw.email ?? "",
    };
    return cachedUser;
  },

  /**
   * A signed-in `gh` proves nothing about this repository: the account it holds
   * may simply not be a member of the owner. GitHub answers 404 rather than 403
   * for a private repo an account cannot see, so "missing" and "not yours" are
   * the same answer and the hint has to cover both.
   */
  async repoAccess({ org, repo }): Promise<RepoAccess> {
    if (!org || !repo) return { ok: true };
    let account = "the signed-in account";
    try {
      account = (await github.currentUser()).id || account;
    } catch {
      // Not signed in at all is reported by the row above this one.
    }
    try {
      const raw = await githubRequest<any>(`repos/${org}/${repo}`);
      const permission: string = raw.permissions?.admin
        ? "admin"
        : raw.permissions?.push
          ? "write"
          : "read";
      if (permission === "read") {
        return {
          ok: false,
          permission,
          reason: `${account} can read ${org}/${repo} but not write to it, so comments and reviews will be refused.`,
          hint: `ask for write access, or run 'gh auth switch' to an account that has it`,
        };
      }
      return { ok: true, permission };
    } catch (error) {
      const message = (error as Error).message;
      const missing = message.includes("404") || message.includes("Could not resolve");
      return {
        ok: false,
        reason: missing
          ? `${account} cannot see ${org}/${repo}. Either it does not exist, or it is private and this account is not a member.`
          : `${org}/${repo} could not be read: ${message.slice(0, 200)}`,
        hint: missing
          ? `run 'gh auth switch' if you have another account, or 'gh auth login' as one with access`
          : `check the repository name and run 'gh auth status'`,
      };
    }
  },

  /**
   * Two things GitHub keeps apart and the dashboard shows together: inline
   * review conversations, which resolve, and comments on the pull request
   * itself, which do not.
   */
  async threads(ref: PullRequestRef): Promise<Thread[]> {
    const [inline, general] = await Promise.all([
      graphql<any>(REVIEW_THREADS, { owner: ref.org, name: ref.repo, number: ref.prId }),
      githubRequest<any[]>(`repos/${ref.org}/${ref.repo}/issues/${ref.prId}/comments?per_page=100`),
    ]);

    const reviewThreads: Thread[] = (inline?.repository?.pullRequest?.reviewThreads?.nodes ?? [])
      .map((thread: any) => {
        const comments = (thread.comments?.nodes ?? []).filter((comment: any) => comment?.databaseId);
        if (!comments.length) return null;
        return {
          // The root comment's id is the thread's id here: it is what a reply
          // is addressed to, and the only number GitHub gives a thread.
          id: comments[0].databaseId,
          status: thread.isResolved ? "resolved" : "active",
          filePath: thread.path ?? null,
          line: thread.line ?? thread.originalLine ?? null,
          isDeleted: false,
          outdated: Boolean(thread.isOutdated),
          comments: comments.map((comment: any) => ({
            id: comment.databaseId,
            author: comment.author?.login ?? "unknown",
            content: comment.body ?? "",
            publishedDate: comment.createdAt,
            commentType: "text",
          })),
        } as Thread;
      })
      .filter(Boolean);

    const generalThreads: Thread[] = (general ?? []).map((comment) => ({
      id: comment.id,
      status: "active",
      filePath: null,
      line: null,
      isDeleted: false,
      // A comment on the pull request itself is not a conversation GitHub can
      // resolve, so the dashboard must not offer to.
      canSetStatus: false,
      comments: [
        {
          id: comment.id,
          author: comment.user?.login ?? "unknown",
          content: comment.body ?? "",
          publishedDate: comment.created_at,
          commentType: "text",
        },
      ],
    }));

    return [...reviewThreads, ...generalThreads];
  },

  /**
   * An inline conversation takes a threaded reply; a comment on the pull
   * request itself can only be answered by another comment on it.
   */
  async reply(ref: PullRequestRef, thread: Thread, content: string): Promise<{ commentId: number }> {
    if (thread.filePath) {
      const raw = await githubRequest<any>(
        `repos/${ref.org}/${ref.repo}/pulls/${ref.prId}/comments/${thread.id}/replies`,
        { method: "POST", body: { body: content } },
      );
      return { commentId: raw.id };
    }
    const raw = await githubRequest<any>(`repos/${ref.org}/${ref.repo}/issues/${ref.prId}/comments`, {
      method: "POST",
      body: { body: content },
    });
    return { commentId: raw.id };
  },
};
