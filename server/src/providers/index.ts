import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db, now } from "../db.js";
import { projectRoot } from "../paths.js";
import { azure } from "./azure.js";
import { github } from "./github.js";
import {
  PROVIDER_KINDS,
  type Account,
  type Provider,
  type ProviderKind,
  type PullRequestRef,
  type RepoCoordinates,
  type Thread,
} from "./types.js";

export * from "./types.js";
export { azure } from "./azure.js";
export { github } from "./github.js";

const exec = promisify(execFile);

/** Azure first, because it is the one this tool was written against. */
const PROVIDERS: Record<ProviderKind, Provider> = { azure, github };

export function providerFor(kind: ProviderKind | string | undefined): Provider {
  const provider = PROVIDERS[kind as ProviderKind];
  if (!provider) throw new Error(`Unknown provider: ${kind}. Known ones are ${PROVIDER_KINDS.join(" and ")}.`);
  return provider;
}

export function allProviders(): Provider[] {
  return PROVIDER_KINDS.map((kind) => PROVIDERS[kind]);
}

/* ------------------------------------------------------- where we are */

export interface RepoContext extends RepoCoordinates {
  /** Empty when nothing identified the host, which is a state the UI shows. */
  provider: ProviderKind | "";
  source: "git-remote" | "cli-defaults" | "none";
  remoteUrl?: string;
}

export const EMPTY_CONTEXT: RepoContext = { provider: "", org: "", project: "", repo: "", source: "none" };

/** Which host a remote URL belongs to, for any code that holds one. */
export function parseRemote(url: string): (RepoCoordinates & { provider: ProviderKind }) | null {
  for (const provider of allProviders()) {
    const parsed = provider.parseRemote(url);
    if (parsed) return { ...parsed, provider: provider.kind };
  }
  return null;
}

async function fromGitRemote(repoPath: string): Promise<RepoContext | null> {
  try {
    const { stdout } = await exec("git", ["-C", repoPath, "remote", "get-url", "origin"], {
      windowsHide: true,
    });
    const parsed = parseRemote(stdout);
    return parsed ? { ...parsed, source: "git-remote", remoteUrl: stdout.trim() } : null;
  } catch {
    return null;
  }
}

/**
 * Only reached when the remote said nothing: no remote, or one belonging to a
 * host this tool does not know. Asking every installed CLI in turn is the
 * honest order, since nothing better distinguishes them at that point.
 */
async function fromCliDefaults(): Promise<RepoContext | null> {
  for (const provider of allProviders()) {
    const defaults = await provider.cliDefaults().catch(() => null);
    if (defaults?.org) return { ...defaults, provider: provider.kind, source: "cli-defaults" };
  }
  return null;
}

let cached: RepoContext | null = null;
/** The host of the repo the tool was started in, once something has said so. */
let pinned: ProviderKind | null = null;

/**
 * The git remote first: it is the repo actually being reviewed, and it is what
 * makes having both CLIs installed unambiguous rather than a guess.
 */
export async function detectContext(repoPath = projectRoot, force = false): Promise<RepoContext> {
  if (cached && !force && repoPath === projectRoot) return cached;
  const detected = (await fromGitRemote(repoPath)) ?? (await fromCliDefaults()) ?? EMPTY_CONTEXT;
  if (repoPath === projectRoot) {
    cached = detected;
    if (detected.provider) pinned = detected.provider;
  }
  return detected;
}

/* ------------------------------------------------------- connections */

export interface Connection {
  provider: ProviderKind;
  label: string;
  cli: string;
  signInHint: string;
  orgLabel: string;
  projectLabel: string;
  threadStates: Provider["threadStates"];
  /** Which of those states mean "dealt with", for the open/resolved filter. */
  resolvedStates: string[];
  /** The CLI is not on this machine at all, which is not an error to report. */
  installed: boolean;
  signedIn: boolean;
  user: Account | null;
  /** Why the identity could not be read, when the CLI is there but unusable. */
  error?: string;
}

/**
 * Every host this tool knows, and what it can say about each one right now.
 * A machine with one CLI shows one usable row; a machine with both shows both,
 * so neither kind of user has to read around the other.
 */
export async function listConnections(context: RepoContext): Promise<Connection[]> {
  return Promise.all(
    allProviders().map(async (provider): Promise<Connection> => {
      const installed = await provider.cliInstalled();
      const base = {
        provider: provider.kind,
        label: provider.label,
        cli: provider.cli,
        signInHint: provider.signInHint,
        orgLabel: provider.orgLabel,
        projectLabel: provider.projectLabel,
        threadStates: provider.threadStates,
        resolvedStates: provider.resolvedStates,
        installed,
      };
      if (!installed) return { ...base, signedIn: false, user: null };

      // Azure identity is read per organisation, so it needs the one in play.
      const org = context.provider === provider.kind ? context.org : "";
      try {
        const user = await provider.currentUser(org);
        return { ...base, signedIn: true, user };
      } catch (error) {
        return { ...base, signedIn: false, user: null, error: (error as Error).message };
      }
    }),
  );
}

let available: Provider[] | null = null;

/** The hosts whose CLI is actually on this machine: what the agent can drive. */
export async function installedProviders(): Promise<Provider[]> {
  const installed = await Promise.all(
    allProviders().map(async (provider) => ((await provider.cliInstalled()) ? provider : null)),
  );
  available = installed.filter((provider): provider is Provider => Boolean(provider));
  return available;
}

/** Only the hosts whose CLI was actually found, with nothing pinned in. */
export function reachableProviders(): Provider[] {
  return available ?? [];
}

/**
 * Which hosts the agent should be told about, without the CLI calls, for the
 * prompt builders that run on every turn. Boot fills it; until then, and on a
 * machine with neither CLI, every host is assumed reachable rather than none.
 *
 * The host of the repo in front of us is always included even when its CLI is
 * missing: being told to drive the wrong host is worse than being told to drive
 * one that is not installed, which fails with a message that says so.
 */
export function availableProviders(): Provider[] {
  const installed = available?.length ? available : allProviders();
  if (!pinned) return installed;
  const rest = installed.filter((provider) => provider.kind !== pinned);
  return [PROVIDERS[pinned], ...rest];
}

/* ------------------------------------------------------------ reads */

export function prKey(ref: PullRequestRef): string {
  return `${ref.provider}/${ref.org}/${ref.project}/${ref.repo}/${ref.prId}`;
}

/**
 * The Threads tab. Caching and the empty-thread filter are the same whoever
 * the host is, so they live here and the provider only fetches.
 */
export async function getThreads(ref: PullRequestRef, useCache = false): Promise<Thread[]> {
  if (useCache) {
    const row = db.prepare("SELECT json FROM pr_threads WHERE pr_key = ?").get(prKey(ref)) as
      | { json: string }
      | undefined;
    if (row) return JSON.parse(row.json) as Thread[];
  }
  const threads = await providerFor(ref.provider).threads(ref);
  const visible = threads.filter((thread) => !thread.isDeleted && thread.comments.length > 0);
  db.prepare(
    "INSERT INTO pr_threads (pr_key, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(pr_key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
  ).run(prKey(ref), JSON.stringify(visible), now());
  return visible;
}

/**
 * The one write the server does itself. It needs the thread rather than its id
 * because GitHub answers an inline conversation and a comment on the pull
 * request through different endpoints.
 */
export async function replyToThread(
  ref: PullRequestRef,
  threadId: number,
  content: string,
): Promise<{ commentId: number }> {
  const threads = await getThreads(ref, true);
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) throw new Error(`Thread ${threadId} is not on pull request ${ref.prId}. Refresh the Threads tab.`);
  return providerFor(ref.provider).reply(ref, thread, content);
}
