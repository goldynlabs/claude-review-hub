import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Account, Provider, PullRequestRef, RepoAccess, RepoCoordinates, Thread } from "./types.js";

const exec = promisify(execFile);

/** Fixed resource GUID for Azure DevOps. */
const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

let cachedToken: { value: string; expiresAt: number } | null = null;

export class AzureAuthError extends Error {}

/**
 * Auth piggybacks on the developer's own `az login`; no PAT to store anywhere.
 */
async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  try {
    const { stdout } = await exec(
      "az",
      ["account", "get-access-token", "--resource", AZURE_DEVOPS_RESOURCE, "-o", "json"],
      { shell: true, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as { accessToken: string; expiresOn?: string };
    const expiresAt = parsed.expiresOn ? new Date(parsed.expiresOn).getTime() : Date.now() + 30 * 60_000;
    cachedToken = { value: parsed.accessToken, expiresAt };
    return parsed.accessToken;
  } catch (error) {
    throw new AzureAuthError(
      `Could not get an Azure DevOps token. Run 'az login' and make sure the azure-devops extension is installed. (${(error as Error).message})`,
    );
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  apiVersion?: string;
}

/**
 * Every Azure call goes through here, so the reads the dashboard performs and
 * the errors it shows have one shape.
 */
async function azureRequest<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const url = new URL(`https://dev.azure.com/${pathname.replace(/^\//, "")}`);
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", options.apiVersion ?? "7.1");

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Azure DevOps ${response.status} on ${url.pathname}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Parses every shape an Azure DevOps remote comes in:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 */
export function parseAzureRemote(url: string): RepoCoordinates | null {
  const cleaned = url.trim().replace(/\.git$/, "");

  const ssh = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/.exec(cleaned);
  if (ssh) return { org: ssh[1], project: decodeURIComponent(ssh[2]), repo: ssh[3] };

  const https = /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+)$/.exec(cleaned);
  if (https) return { org: https[1], project: decodeURIComponent(https[2]), repo: decodeURIComponent(https[3]) };

  const legacy =
    /^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/(.+)$/.exec(cleaned);
  if (legacy) return { org: legacy[1], project: decodeURIComponent(legacy[2]), repo: decodeURIComponent(legacy[3]) };

  return null;
}

/**
 * `az devops configure` stores a URL, in either the modern or the legacy shape.
 * Only the organisation name goes into a REST path, never the host.
 */
export function normaliseOrg(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const legacy = /^https?:\/\/([^./]+)\.visualstudio\.com/.exec(trimmed);
  if (legacy) return legacy[1];
  const modern = /^https?:\/\/dev\.azure\.com\/([^/]+)/.exec(trimmed);
  if (modern) return modern[1];
  return trimmed.includes("/") ? (trimmed.split("/").pop() ?? "") : trimmed;
}

let cachedUser: { org: string; user: Account } | null = null;
let cachedAccount: Account | null = null;

/** The Azure account `az login` holds, with no Azure DevOps organisation involved. */
async function signedInAccount(): Promise<Account> {
  if (cachedAccount) return cachedAccount;
  try {
    const { stdout } = await exec("az", ["account", "show", "-o", "json"], {
      shell: true,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const raw = JSON.parse(stdout) as { user?: { name?: string } };
    const name = raw.user?.name ?? "";
    if (!name) throw new Error("az reported no account");
    cachedAccount = { id: name, displayName: name, email: name };
    return cachedAccount;
  } catch (error) {
    throw new AzureAuthError(`Not signed in to Azure. Run 'az login'. (${(error as Error).message})`);
  }
}

export const azure: Provider = {
  kind: "azure",
  label: "Azure DevOps",
  cli: "az",
  skill: "azure-pr-master",
  signInHint: "az login",
  orgLabel: "Organisation",
  projectLabel: "Project",
  // Azure's own vocabulary, exactly as its pull request UI words it.
  threadStates: [
    { value: "active", label: "Active" },
    { value: "pending", label: "Pending" },
    { value: "fixed", label: "Fixed" },
    { value: "wontFix", label: "Will not fix" },
    { value: "closed", label: "Closed" },
  ],
  resolvedStates: ["fixed", "wontFix", "closed"],
  closeThreadPhrase: "Set that thread to fixed",

  parseRemote: parseAzureRemote,

  prUrl: (ref) => `https://dev.azure.com/${ref.org}/${ref.project}/_git/${ref.repo}/pullrequest/${ref.prId}`,

  async cliInstalled() {
    try {
      await exec("az", ["version"], { shell: true, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      return true;
    } catch {
      return false;
    }
  },

  /** `az devops configure --defaults organization=... project=...`, if it was set. */
  async cliDefaults() {
    try {
      const { stdout } = await exec("az", ["devops", "configure", "--list"], {
        shell: true,
        windowsHide: true,
      });
      const values = Object.fromEntries(
        stdout
          .split(/\r?\n/)
          .map((line) => line.split("=").map((part) => part.trim()))
          .filter((parts) => parts.length === 2),
      ) as Record<string, string>;
      const organisation = values.organization ?? values.organisation;
      if (!organisation) return null;
      const org = normaliseOrg(organisation);
      return org ? { org, project: values.project ?? "", repo: "" } : null;
    } catch {
      return null;
    }
  },

  /**
   * Who the `az login` token belongs to, as Azure DevOps sees them. With no
   * organisation in play there is nothing to ask Azure DevOps about, but `az`
   * still knows who is signed in, and that is the question being answered:
   * saying "not signed in" there would be a plain lie on a GitHub repo.
   */
  async currentUser(organisation?: string): Promise<Account> {
    const target = organisation ?? "";
    if (!target) return signedInAccount();
    if (cachedUser?.org === target) return cachedUser.user;
    const raw = await azureRequest<any>(`${target}/_apis/ConnectionData`, { apiVersion: "7.1-preview" });
    const authenticated = raw.authenticatedUser ?? {};
    const user: Account = {
      id: authenticated.id,
      displayName: authenticated.providerDisplayName ?? authenticated.customDisplayName ?? "unknown",
      email: authenticated.properties?.Account?.$value ?? "",
    };
    cachedUser = { org: target, user };
    return user;
  },

  /**
   * Azure fails in more ways than GitHub, and each one has a different fix: the
   * account may be signed in to the wrong tenant, the organisation may not be
   * one it belongs to, the project may be wrong, or the repository may simply
   * not be there. The status code tells them apart.
   */
  async repoAccess({ org, project, repo }): Promise<RepoAccess> {
    if (!org || !repo) return { ok: true };
    let account = "the signed-in account";
    try {
      account = (await azure.currentUser(org)).displayName || account;
    } catch {
      // Not signed in at all is reported by the row above this one.
    }

    const where = project ? `${org}/${project}` : org;
    try {
      // Repo-scoped, so it answers for exactly the thing the buttons will use.
      const path = project
        ? `${org}/${project}/_apis/git/repositories/${encodeURIComponent(repo)}`
        : `${org}/_apis/git/repositories/${encodeURIComponent(repo)}`;
      await azureRequest<any>(path);
      return { ok: true };
    } catch (error) {
      const message = (error as Error).message;
      const status = /Azure DevOps (\d{3})/.exec(message)?.[1] ?? "";

      if (status === "401")
        return {
          ok: false,
          reason: `${account} is not authorised for ${org}. The token is for a different tenant or the account is not a member.`,
          hint: `run 'az login --tenant <tenant>' for the tenant that owns ${org}`,
        };
      if (status === "403")
        return {
          ok: false,
          reason: `${account} is a member of ${org} but not allowed to read ${repo}.`,
          hint: "ask for access to that repository in Azure DevOps",
        };
      if (status === "404")
        return {
          ok: false,
          reason: `${repo} was not found in ${where}. The organisation, project or repository name does not match.`,
          hint: project
            ? "check the name against the pull request URL"
            : `this repo has no project yet; paste a full pull request URL so ${org} and its project are read from it`,
        };
      return {
        ok: false,
        reason: `${where} could not be read: ${message.slice(0, 200)}`,
        hint: "run 'az account show' and check you are on the right subscription and tenant",
      };
    }
  },

  async threads(ref: PullRequestRef): Promise<Thread[]> {
    const raw = await azureRequest<{ value: any[] }>(
      `${ref.org}/${ref.project}/_apis/git/repositories/${ref.repo}/pullRequests/${ref.prId}/threads`,
    );
    return raw.value.map((thread) => ({
      id: thread.id,
      status: thread.status ?? "unknown",
      filePath: thread.threadContext?.filePath ?? null,
      line: thread.threadContext?.rightFileStart?.line ?? null,
      isDeleted: Boolean(thread.isDeleted),
      comments: (thread.comments ?? [])
        .filter((comment: any) => comment.commentType !== "system" && !comment.isDeleted)
        .map((comment: any) => ({
          id: comment.id,
          author: comment.author?.displayName ?? "unknown",
          content: comment.content ?? "",
          publishedDate: comment.publishedDate,
          commentType: comment.commentType ?? "text",
        })),
    }));
  },

  async reply(ref: PullRequestRef, thread: Thread, content: string): Promise<{ commentId: number }> {
    const raw = await azureRequest<any>(
      `${ref.org}/${ref.project}/_apis/git/repositories/${ref.repo}/pullRequests/${ref.prId}/threads/${thread.id}/comments`,
      { method: "POST", body: { parentCommentId: 0, content, commentType: 1 } },
    );
    return { commentId: raw.id };
  },
};
