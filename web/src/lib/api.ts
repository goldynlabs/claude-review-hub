import type {
  ActionTemplate,
  Backup,
  BackupSection,
  ConfigState,
  Analytics,
  Connection,
  Finding,
  GlobalBackup,
  PermissionRequest,
  Profile,
  ProfileSuggestion,
  ReviewEvent,
  RepoContext,
  Session,
  SessionPr,
  Settings,
  Thread,
  ThreadStats,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // A proxy or a crash can answer with HTML; surface it instead of blowing up on parse.
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    throw new Error("The server returned a response that was not JSON.");
  }
  if (!response.ok) throw new Error(payload.error ?? response.statusText);
  return payload as T;
}

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () =>
    request<{
      ok: boolean;
      /** The tool's own version, for the header. */
      version: string;
      projectRoot: string;
      project: string;
      context: RepoContext;
    }>("/health"),

  /** What the server worked out from the git remote, and who each CLI is signed in as. */
  connections: (refresh = false) =>
    request<{ detected: RepoContext; context: RepoContext; connections: Connection[] }>(
      `/connections${refresh ? "?refresh=1" : ""}`,
    ),

  settings: () => request<Settings>("/settings"),
  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(patch) }),

  profiles: () => request<Profile[]>("/profiles"),
  saveProfile: (profile: Profile) =>
    request<Profile>(`/profiles/${profile.id}`, { method: "PUT", body: JSON.stringify(profile) }),
  deleteProfile: (id: string) => request<Profile[]>(`/profiles/${id}`, { method: "DELETE" }),
  /** Runs the prompt the dashboard showed in a Claude of its own, and hands back its answer. */
  generateDimensions: (prompt: string) =>
    request<{ text: string }>("/dimensions/generate", { method: "POST", body: JSON.stringify({ prompt }) }),

  /**
   * Auto detect between its two turns: a Claude of its own says which profile
   * fits each pull request in the session. Nothing is stored by asking.
   */
  suggestProfiles: (sessionId: string, note = "", prompt?: string) =>
    post<{ suggestions: ProfileSuggestion[] }>(`/sessions/${sessionId}/profiles/suggest`, { note, prompt }),
  /** What the reviewer settled on in that modal, which the review is built from. */
  savePrProfiles: (
    sessionId: string,
    choices: Array<{ sessionPrId: string; profileId: string | null; note: string }>,
  ) => request<SessionPr[]>(`/sessions/${sessionId}/pr-profiles`, { method: "PUT", body: JSON.stringify({ choices }) }),

  sessions: () => request<Session[]>("/sessions"),
  createSession: (input: { title?: string; profileId?: string; extraContext?: string }) =>
    post<Session>("/sessions", input),
  session: (id: string) =>
    request<{
      session: Session;
      prs: SessionPr[];
      findings: Finding[];
      pendingPermissions: PermissionRequest[];
    }>(`/sessions/${id}`),
  events: (id: string, after = 0) => request<ReviewEvent[]>(`/sessions/${id}/events?after=${after}`),
  updateSession: (id: string, patch: Partial<Session>) =>
    request<Session>(`/sessions/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteSession: (id: string) => request<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" }),

  /** Stops the turn in flight; the Claude session and its context survive. */
  stop: (sessionId: string) => post<{ stopped: boolean; running: boolean }>(`/sessions/${sessionId}/stop`),

  /**
   * Free text: PR ids, URLs or a sentence. The agent resolves and prepares
   * whatever it names, so this returns at once and the work streams in.
   */
  review: (sessionId: string, request = "", note = "") =>
    post<{ started: boolean }>(`/sessions/${sessionId}/review`, { request, note }),

  chat: (sessionId: string, body: { message: string; sessionPrId?: string; threadId?: number; bare?: boolean }) =>
    post<{ accepted: boolean }>(`/sessions/${sessionId}/chat`, body),

  /** Prompt templates behind every button, so a tooltip can show what it sends. */
  actions: () => request<ActionTemplate[]>("/actions"),

  /** Rewrites one template for good; an empty one puts the built-in back. */
  savePrompt: (actionId: string, template: string) =>
    request<{ actions: ActionTemplate[] }>(`/prompts/${actionId}`, { method: "PUT", body: JSON.stringify({ template }) }),
  resetPrompt: (actionId: string) =>
    request<{ actions: ActionTemplate[] }>(`/prompts/${actionId}`, { method: "DELETE" }),

  /** Settings, profiles and rewritten templates as one document, to save to disk. */
  backup: (sections: BackupSection[]) => request<Backup>(`/backup?sections=${sections.join(",")}`),
  /** The other end of it: each chosen section becomes exactly what the file says. */
  importBackup: (file: Backup, sections: BackupSection[]) =>
    post<{ applied: BackupSection[] } & ConfigState>("/backup/import", { file, sections }),
  /** The copy kept for the whole machine: what is in it, and the two directions. */
  globalBackup: () => request<GlobalBackup>("/backup/global"),
  syncToGlobal: (sections: BackupSection[]) => post<GlobalBackup>("/backup/global", { sections }),
  syncFromGlobal: (sections: BackupSection[]) =>
    post<{ applied: BackupSection[] } & ConfigState>("/backup/global/import", { sections }),
  /** Back to a fresh install's configuration, keeping what only this machine knows. */
  resetConfig: () => post<ConfigState>("/backup/reset"),

  /**
   * The prompt an action will send, in its reading form: long values are left
   * as `{placeholder}` and returned in `values`, to be shown on hover. A null
   * session is the prompt shown before one exists, when the sidebar asks
   * whether to start a review at all.
   */
  actionPreview: (sessionId: string | null, actionId: string, params: Record<string, string>) =>
    request<{ prompt: string; values: Record<string, string>; full: string }>(
      `${sessionId ? `/sessions/${sessionId}` : ""}/actions/${actionId}/preview?${new URLSearchParams(params).toString()}`,
    ),

  /** `params.prompt`, when present, is the reviewer's rewrite and is sent as is. */
  runAction: (sessionId: string, actionId: string, params: Record<string, unknown>) =>
    post<{ started: boolean }>(`/sessions/${sessionId}/actions/${actionId}`, params),

  threads: (sessionPrId: string, cache = false) =>
    request<Thread[]>(`/session-prs/${sessionPrId}/threads${cache ? "?cache=1" : ""}`),
  reply: (sessionPrId: string, threadId: number, content: string) =>
    post(`/session-prs/${sessionPrId}/threads/${threadId}/reply`, { content }),

  diff: async (sessionPrId: string, file?: string) => {
    const response = await fetch(
      `/api/session-prs/${sessionPrId}/diff${file ? `?file=${encodeURIComponent(file)}` : ""}`,
    );
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  },

  setFindingStatus: (id: string, status: Finding["status"]) => post<Finding>(`/findings/${id}/status`, { status }),

  decide: (requestId: string, allow: boolean) => post(`/permissions/${requestId}`, { allow }),

  /** Everything recorded so far, counted; reads only the database. */
  analytics: () => request<Analytics>("/analytics"),

  /**
   * Comment thread counts per pull request. Cached by default, which is
   * instant; `live` reads each pull request from its host instead.
   */
  threadStats: (live = false) => request<ThreadStats>(`/analytics/threads${live ? "?live=1" : ""}`),
};
