/**
 * What the dashboard needs from a code host. Deliberately small: the agent does
 * the writing itself through the host's own CLI, so the only things the server
 * asks a provider for are the reads that draw the screen, plus one reply.
 */
export type ProviderKind = "azure" | "github";

export const PROVIDER_KINDS: ProviderKind[] = ["azure", "github"];

export interface PullRequestRef {
  provider: ProviderKind;
  org: string;
  /** Azure's team project. GitHub has no such level, and leaves it empty. */
  project: string;
  repo: string;
  prId: number;
}

export interface Comment {
  id: number;
  author: string;
  content: string;
  publishedDate: string;
  commentType: string;
}

export interface Thread {
  id: number;
  status: string;
  filePath: string | null;
  line: number | null;
  isDeleted: boolean;
  /**
   * False when this host cannot change the state of this particular thread, as
   * GitHub cannot resolve a comment left on the pull request itself. The
   * dashboard then leaves the state control out rather than offering a click
   * that would fail.
   */
  canSetStatus?: boolean;
  /** The lines it was written against have since changed. GitHub only. */
  outdated?: boolean;
  comments: Comment[];
}

export interface Account {
  id: string;
  displayName: string;
  email: string;
}

/** What a remote URL, or the host's CLI defaults, say about where we are. */
export interface RepoCoordinates {
  org: string;
  project: string;
  repo: string;
}

export interface ThreadState {
  value: string;
  label: string;
}

/**
 * The answer to "can this account do anything with this repository". `hint` is
 * the command that fixes it, because a reviewer who cannot act wants the next
 * step, not a diagnosis.
 */
export interface RepoAccess {
  ok: boolean;
  /** What the host calls the level, when it says: admin, write, read. */
  permission?: string;
  /** Why not, in one line, naming the account and the repo. */
  reason?: string;
  hint?: string;
}

/**
 * One code host. Everything host-shaped lives behind this: the words its own UI
 * uses, the CLI the agent drives, the skill that documents it, and the handful
 * of reads the dashboard performs itself.
 */
export interface Provider {
  kind: ProviderKind;
  /** What the host calls itself, for anything a person reads. */
  label: string;
  /** The CLI the agent drives to change a pull request. */
  cli: string;
  /** The skill that documents that CLI. */
  skill: string;
  /** What to run when nothing is signed in. */
  signInHint: string;
  /** What `org` means here, so the sidebar is not lying to half its users. */
  orgLabel: string;
  /** Empty when the host has no such level; the UI then omits the row. */
  projectLabel: string;
  /** The thread states this host understands, in its own vocabulary. */
  threadStates: ThreadState[];
  /** Which of those mean "dealt with", for the open/resolved filter. */
  resolvedStates: string[];
  /** How this host words closing a conversation, for the prompts that ask for it. */
  closeThreadPhrase: string;

  parseRemote(url: string): RepoCoordinates | null;
  prUrl(ref: PullRequestRef): string;
  /** Whether the CLI is installed at all, which is what gates the skill. */
  cliInstalled(): Promise<boolean>;
  /** Coordinates the CLI itself is configured with, when the remote said nothing. */
  cliDefaults(): Promise<RepoCoordinates | null>;
  currentUser(org?: string): Promise<Account>;
  /**
   * Whether the signed-in account can actually reach *this* repository. Being
   * signed in is not the same thing: the CLI may hold a different account from
   * the one the repo belongs to, and every button would then fail one at a time
   * with a message about GraphQL rather than about accounts.
   */
  repoAccess(coordinates: RepoCoordinates): Promise<RepoAccess>;
  threads(ref: PullRequestRef): Promise<Thread[]>;
  /** `thread` is the one being answered, which is how the reply finds its shape. */
  reply(ref: PullRequestRef, thread: Thread, content: string): Promise<{ commentId: number }>;
}
