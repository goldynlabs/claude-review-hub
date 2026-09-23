import { create } from "zustand";
import { api } from "./api";
import { readUrl, writeUrl } from "./url";
import type {
  ActionTemplate,
  Connection,
  Finding,
  PermissionRequest,
  QuestionRequest,
  Profile,
  ProviderKind,
  RepoContext,
  ReviewEvent,
  Session,
  SessionPr,
  Settings,
} from "./types";

interface State {
  sessions: Session[];
  profiles: Profile[];
  /** Prompt templates for every agent-backed button. */
  actions: ActionTemplate[];
  settings: Settings | null;
  project: string;
  projectRoot: string;
  /** Host, organisation and repo worked out from the repo's origin remote. */
  context: RepoContext;
  /** What the server reports itself as, shown beside the name in the header. */
  version: string;
  /** Every host this tool knows, and who each CLI is signed in as. */
  connections: Connection[];

  sessionId: string | null;
  session: Session | null;
  prs: SessionPr[];
  findings: Finding[];
  events: ReviewEvent[];
  permissions: PermissionRequest[];
  /** What the agent has asked the reviewer, and is waiting on. */
  questions: QuestionRequest[];
  activePrId: string | null;
  busy: boolean;
  /** Text the agent is producing right now, before the block is complete. */
  streaming: { label?: string; text: string } | null;
  /** PRs being resolved, and what step each one is on. */
  preparing: Record<number, string>;

  boot: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  setActivePr: (id: string | null) => void;
  applyEvent: (event: ReviewEvent) => void;
  setSettings: (settings: Settings) => void;
  setConnections: (value: { context: RepoContext; connections: Connection[] }) => void;
  setProfiles: (profiles: Profile[]) => void;
  /** After a template is rewritten, so every hover and confirmation follows. */
  setActions: (actions: ActionTemplate[]) => void;
}

let eventSource: EventSource | null = null;
let openGeneration = 0;
let refreshGeneration = 0;

export const useStore = create<State>((set, get) => ({
  sessions: [],
  profiles: [],
  actions: [],
  settings: null,
  project: "",
  projectRoot: "",
  context: { provider: "", org: "", project: "" },
  version: "",
  connections: [],

  sessionId: null,
  session: null,
  prs: [],
  findings: [],
  events: [],
  permissions: [],
  questions: [],
  activePrId: null,
  busy: false,
  streaming: null,
  preparing: {},

  boot: async () => {
    const [health, settings, profiles, sessions, actions] = await Promise.all([
      api.health(),
      api.settings(),
      api.profiles(),
      api.sessions(),
      api.actions(),
    ]);
    set({
      project: health.project,
      projectRoot: health.projectRoot,
      context: health.context,
      version: health.version,
      settings,
      profiles,
      sessions,
      actions,
    });
    // The accounts each CLI is signed in as take a second or two to read, and
    // the dashboard has everything it needs to draw without them. Asked for
    // once the page is up, and filled in when they arrive.
    void api
      .connections()
      .then((result) => set({ context: result.context, connections: result.connections }))
      .catch(() => undefined);

    if (!sessions.length || get().sessionId) return;
    // Only what the address bar asks for: a bare url is someone arriving, not
    // someone returning, and they get the walk through the tool rather than
    // whichever review happens to be newest.
    const asked = readUrl("session");
    const wanted = sessions.find((session) => session.id === asked);
    if (wanted) await get().openSession(wanted.id);
  },

  refreshSessions: async () => set({ sessions: await api.sessions() }),

  openSession: async (id) => {
    const generation = ++openGeneration;
    refreshGeneration += 1;
    set({ busy: true });
    let data: Awaited<ReturnType<typeof api.session>>;
    let events: Awaited<ReturnType<typeof api.events>>;
    try {
      [data, events] = await Promise.all([api.session(id), api.events(id)]);
    } catch (error) {
      if (generation === openGeneration) set({ busy: false });
      throw error;
    }
    if (generation !== openGeneration) return;
    eventSource?.close();
    eventSource = null;
    set({
      sessionId: id,
      session: data.session,
      prs: data.prs,
      findings: data.findings,
      permissions: data.pendingPermissions,
      questions: data.pendingQuestions ?? [],
      events,
      activePrId: data.prs.find((pr) => pr.id === readUrl("pr"))?.id ?? data.prs.at(-1)?.id ?? null,
      streaming: null,
      preparing: {},
      busy: false,
    });
    writeUrl({ session: id, pr: get().activePrId });

    // One live feed per open session; every panel is derived from it.
    const lastSeq = events.length ? events[events.length - 1].seq : 0;
    eventSource = new EventSource(`/api/sessions/${id}/stream?after=${lastSeq}`);
    eventSource.onmessage = (message) => {
      if (get().sessionId !== id) return;
      const event = JSON.parse(message.data) as ReviewEvent;
      get().applyEvent(event);
    };
  },

  removeSession: async (id) => {
    await api.deleteSession(id);
    const sessions = (await api.sessions()).filter((session) => session.id !== id);
    set({ sessions });
    // Deleting the open session leaves the panel on the next one, or on nothing.
    if (get().sessionId === id) {
      eventSource?.close();
      eventSource = null;
      set({
        sessionId: null,
        session: null,
        prs: [],
        findings: [],
        events: [],
        permissions: [],
        questions: [],
        activePrId: null,
      });
      writeUrl({ session: null, pr: null });
      if (sessions.length) await get().openSession(sessions[0].id);
    }
  },

  setActivePr: (id) => {
    set({ activePrId: id });
    writeUrl({ pr: id });
  },

  applyEvent: (event) => {
    const state = get();

    // Live-only events never enter the stored log; they drive the streaming view.
    if (event.transient) {
      switch (event.type) {
        case "assistant.delta":
          set({
            streaming: {
              label: event.payload.label,
              text:
                (state.streaming && state.streaming.label === event.payload.label ? state.streaming.text : "") +
                event.payload.text,
            },
          });
          break;
        case "pr.step":
          set({ preparing: { ...state.preparing, [event.payload.prId]: event.payload.step } });
          break;
        default:
          break;
      }
      return;
    }

    if (state.events.some((existing) => existing.id === event.id)) return;
    const next: Partial<State> = { events: [...state.events, event] };

    switch (event.type) {
      case "pr.resolving": {
        next.preparing = { ...state.preparing, [event.payload.prId]: "resolving" };
        break;
      }
      case "pr.error": {
        const { [event.payload.prId]: _removed, ...rest } = state.preparing;
        next.preparing = rest;
        break;
      }
      case "pr.attached": {
        const pr = event.payload as SessionPr;
        const others = state.prs.filter((item) => item.id !== pr.id);
        next.prs = [...others, pr];
        next.activePrId = state.activePrId ?? pr.id;
        if (pr.state === "ready" || pr.state === "error") {
          const { [pr.prId]: _done, ...rest } = state.preparing;
          next.preparing = rest;
        }
        break;
      }
      case "assistant.text":
      case "run.finished":
      case "run.error":
      case "run.stopped":
        // The stored block supersedes whatever the deltas drew.
        next.streaming = null;
        break;
      case "finding.created":
      case "finding.updated": {
        const finding = event.payload as Finding;
        const others = state.findings.filter((item) => item.id !== finding.id);
        next.findings = [...others, finding];
        break;
      }
      case "permission.requested":
        next.permissions = [...state.permissions, event.payload as PermissionRequest];
        break;
      case "permission.decided":
        next.permissions = state.permissions.filter(
          (request) => request.requestId !== event.payload.requestId,
        );
        break;
      case "question.asked":
        next.questions = [...state.questions, event.payload as QuestionRequest];
        break;
      case "question.answered":
        next.questions = state.questions.filter((request) => request.requestId !== event.payload.requestId);
        break;
      case "session.updated":
        {
          const updated = event.payload as Session;
          next.session = updated;
          next.sessions = state.sessions.map((session) => (session.id === updated.id ? updated : session));
        }
        break;
      case "review.started":
      case "review.finished":
      case "review.error":
        // PR state changed on the server; pull the authoritative rows back.
        {
          const requestedId = state.sessionId!;
          const generation = ++refreshGeneration;
          void api
            .session(requestedId)
            .then((data) => {
              if (generation !== refreshGeneration || get().sessionId !== requestedId) return;
              set((current) => ({
                prs: data.prs,
                session: data.session,
                sessions: current.sessions.map((session) =>
                  session.id === data.session.id ? data.session : session,
                ),
              }));
            })
            .catch(() => undefined);
        }
        break;
      default:
        break;
    }
    set(next);
  },

  setSettings: (settings) => set({ settings }),
  setConnections: ({ context, connections }) => set({ context, connections }),
  setProfiles: (profiles) => set({ profiles }),
  setActions: (actions) => set({ actions }),
}));
