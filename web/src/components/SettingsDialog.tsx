import { useEffect, useRef, useState } from "react";
import { CloudDownload, CloudUpload, Download, Pencil, Plus, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { AccessBadge } from "./ConnectionsSection";
import { useConfirm } from "./Confirm";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import { MODEL_OPTIONS } from "../lib/models";
import { BACKUP_SECTIONS, type ActionTemplate, type BackupSection, type Backup as BackupFile, type GlobalBackup, type Profile, type Settings } from "../lib/types";
import { downloadProfile, ProfileDialog, ProfileForm } from "./ProfileForm";
import { Accordion } from "./ui/Accordion";
import { Button } from "./ui/Button";
import { ReviewDepth } from "./ReviewDepth";
import { Checkbox } from "./ui/Checkbox";
import { Empty } from "./ui/Empty";
import { Field, Group } from "./ui/Field";
import { Input } from "./ui/Input";
import { Modal } from "./ui/Modal";
import { Select, SelectItem } from "./ui/Select";
import { StatusBadge } from "./ui/StatusBadge";
import { Textarea } from "./ui/Textarea";

export type SettingsTab = "general" | "permissions" | "workspace" | "profiles" | "prompts" | "backup";

export function SettingsDialog({
  onClose,
  initialTab,
  initialProfileId,
}: {
  onClose: () => void;
  /** Where to land, for the controls that open this dialog at one thing. */
  initialTab?: SettingsTab;
  initialProfileId?: string;
}) {
  const { settings, profiles, setSettings, setProfiles } = useStore();
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "general");
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [profileId, setProfileId] = useState(initialProfileId ?? profiles[0]?.id ?? "default");
  const [profileDraft, setProfileDraft] = useState<Profile | undefined>(
    profiles.find((item) => item.id === profileId),
  );
  // Reported by the Prompts tab, which owns the template it is editing.
  const [promptDirty, setPromptDirty] = useState(false);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setProfileDraft(profiles.find((item) => item.id === profileId)), [profileId, profiles]);
  if (!draft) return null;

  const save = async (patch: Partial<Settings>) => {
    const next = await api.saveSettings(patch);
    setSettings(next);
    setDraft(next);
  };

  // The profile being edited lives here, not in the tab, because the one thing
  // that saves it is the modal's footer - outside the scrolling body, so it is
  // still there after a screen of dimensions.
  const storedProfile = profiles.find((item) => item.id === profileId);
  const profileDirty = Boolean(profileDraft) && JSON.stringify(storedProfile) !== JSON.stringify(profileDraft);

  /**
   * Whether something is typed but not yet committed. Only the two editors with
   * a Save button of their own count: the fields in General and Workspace save
   * themselves on blur, and clicking outside blurs them, so treating those as
   * unsaved would make the first click a no-op for a change that was already
   * on its way.
   */
  const dirty = profileDirty || promptDirty;

  const saveProfile = async (next: Profile) => {
    await api.saveProfile(next);
    setProfiles(await api.profiles());
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Settings"
      maxWidth="max-w-3xl"
      height="h-[calc(100vh-4rem)]"
      // A click outside must not throw away a profile or a prompt that is
      // half-written. The X and Escape still close: those are deliberate.
      disableOutsideClose={dirty}
      footer={
        tab === "profiles" && profileDirty && profileDraft ? (
          <>
            <span className="mr-auto self-center text-[11px] text-muted-foreground">
              Unsaved changes to this profile.
            </span>
            <Button onClick={() => storedProfile && setProfileDraft(storedProfile)}>Discard</Button>
            <Button variant="primary" onClick={() => saveProfile(profileDraft)}>
              Save profile
            </Button>
          </>
        ) : undefined
      }
    >
      {/* The modal body is the scroller, so the tabs stay reachable from anywhere
          in a long settings page. The negative margin lets the bar cover the
          body padding instead of letting content slide past its sides. */}
      <nav className="sticky top-0 z-10 -mx-5 mb-4 flex gap-1 border-b bg-card px-5 pb-2 pt-1">
        {(["general", "workspace", "profiles", "prompts", "permissions", "backup"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs capitalize hover:bg-muted",
              tab === item && "bg-muted font-medium",
            )}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="min-h-[50vh]">
        {tab === "general" && <General draft={draft} setDraft={setDraft} save={save} />}
        {tab === "permissions" && <Permissions draft={draft} save={save} />}
        {tab === "workspace" && <Workspace draft={draft} setDraft={setDraft} save={save} />}
        {tab === "profiles" && (
          <Profiles
            profiles={profiles}
            setProfiles={setProfiles}
            selectedId={profileId}
            setSelectedId={setProfileId}
            draft={profileDraft}
            setDraft={setProfileDraft}
            save={saveProfile}
          />
        )}
        {tab === "prompts" && <Prompts onDirtyChange={setPromptDirty} />}
        {tab === "backup" && <Backup />}
      </div>
    </Modal>
  );
}

function General({
  draft,
  setDraft,
  save,
}: {
  draft: Settings;
  setDraft: (settings: Settings) => void;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  return (
    <div className="divide-y">
      <Group title="Models" description="Each stage can run on a different model.">
        <Field label="Review" hint="The broad sweep over the diff.">
          <ModelSelect value={draft.models.review} onChange={(review) => save({ models: { ...draft.models, review } })} />
        </Field>
        <Field label="Challenge" hint="Adversarial re-check of a single finding.">
          <ModelSelect
            value={draft.models.challenge}
            onChange={(challenge) => save({ models: { ...draft.models, challenge } })}
          />
        </Field>
        <Field label="Chat" hint="Drives the chat box and every action taken from it.">
          <ModelSelect value={draft.models.chat} onChange={(chat) => save({ models: { ...draft.models, chat } })} />
        </Field>
      </Group>

      <Group title="Review" description="How a review run behaves. The criteria themselves live in profiles.">
        <Field
          label="Session language"
          hint="What Claude writes here: findings, verdicts, summaries and chat replies. The prompts it is sent stay English."
        >
          <Input
            value={draft.sessionLanguage}
            onChange={(event) => setDraft({ ...draft, sessionLanguage: event.target.value })}
            onBlur={() => save({ sessionLanguage: draft.sessionLanguage })}
          />
        </Field>
        <Field
          label="Pull request language"
          hint="What Claude writes into the pull request, on whichever host: comments and thread replies."
        >
          <Input
            value={draft.pullRequestLanguage}
            onChange={(event) => setDraft({ ...draft, pullRequestLanguage: event.target.value })}
            onBlur={() => save({ pullRequestLanguage: draft.pullRequestLanguage })}
          />
        </Field>
        {/* The same three controls the sidebar and the confirmation show: one
            setting, edited wherever a review is about to start. */}
        <div className="col-span-2 pt-1">
          <ReviewDepth />
        </div>
      </Group>
    </div>
  );
}

function Permissions({ draft, save }: { draft: Settings; save: (patch: Partial<Settings>) => Promise<void> }) {
  return (
    <div className="divide-y">
      <Group title="Permissions" description="What Claude may do without being asked.">
        <Field
          label="Approvals"
          hint={
            draft.permissionMode === "auto"
              ? "Nothing is confirmed: comments, votes, merges and shell commands run unattended."
              : "Posting, voting, merging, editing files and running shell commands are confirmed in the chat panel."
          }
        >
          <Select
            value={draft.permissionMode}
            onValueChange={(value) => save({ permissionMode: value as Settings["permissionMode"] })}
          >
            <SelectItem value="ask">Ask me every time</SelectItem>
            <SelectItem value="auto">Auto: run everything without asking</SelectItem>
          </Select>
        </Field>
        <div className="col-span-2">
          <Checkbox
            label="Let Claude edit files in the review worktree (needed for auto-fix and opening a PR)"
            checked={draft.allowCodeEdits}
            onCheckedChange={(checked) => save({ allowCodeEdits: checked })}
          />
        </div>
      </Group>
    </div>
  );
}

function Workspace({
  draft,
  setDraft,
  save,
}: {
  draft: Settings;
  setDraft: (settings: Settings) => void;
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  return (
    <div className="divide-y">
      <Connections />
      <Group title="Workspace">
        <Field label="Worktree TTL (hours)" hint="Review worktrees older than this are removed on start.">
          <Input
            type="number"
            value={draft.worktreeTtlHours}
            onChange={(event) => setDraft({ ...draft, worktreeTtlHours: Number(event.target.value) })}
            onBlur={() => save({ worktreeTtlHours: draft.worktreeTtlHours })}
          />
        </Field>
        <div className="col-span-2">
          <Checkbox
            label="Show token cost per session"
            checked={draft.showCost}
            onCheckedChange={(checked) => save({ showCost: checked })}
          />
        </div>
      </Group>
    </div>
  );
}


/**
 * The hosts this machine can reach, and who each CLI is signed in as. Nothing
 * here is editable: signing in happens in a terminal, and the host a repo
 * belongs to is read from its remote. It is here so that the sidebar's
 * "open Settings" leads somewhere that explains what is missing.
 */
function Connections() {
  const { context, connections, setConnections } = useStore();
  const [detecting, setDetecting] = useState(false);

  const redetect = async () => {
    setDetecting(true);
    try {
      const result = await api.connections(true);
      setConnections({ context: result.context, connections: result.connections });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Group
      title="Connections"
      description="Each host is reached through its own CLI, with the account you signed that CLI in as. No token is stored here."
    >
      <div className="col-span-2 space-y-2">
        {connections.map((connection) => (
          <div key={connection.provider} className="flex flex-wrap items-baseline gap-2 text-xs">
            <span className="w-28 shrink-0 font-medium">{connection.label}</span>
            {connection.signedIn ? (
              <StatusBadge tone="success">{connection.user?.displayName ?? "signed in"}</StatusBadge>
            ) : connection.installed ? (
              <StatusBadge tone="warning">not signed in</StatusBadge>
            ) : (
              // A CLI installed after this process started is not on its PATH,
              // so the badge points at the restart rather than at the installer.
              <StatusBadge tone="off" title="Restart the tool if you just installed it">
                no {connection.cli} on PATH
              </StatusBadge>
            )}
            {/* Signed in is not the same as able, and this tab is where someone
                lands when a button failed: the same badge as the sidebar. */}
            <AccessBadge access={connection.repoAccess} />
            {context.provider === connection.provider && <StatusBadge tone="on">this repo</StatusBadge>}
            {!connection.signedIn && (
              <span className="text-muted-foreground">
                run <code>{connection.signInHint}</code>
              </span>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={redetect} disabled={detecting}>
            <RefreshCw size={12} className={cn(detecting && "animate-spin")} /> Detect again
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {context.provider
              ? `This repo is on ${connections.find((item) => item.provider === context.provider)?.label ?? context.provider}${context.org ? `, under ${context.org}` : ""}.`
              : "This repo's origin remote is on neither host. Paste a full pull request URL and the host in it is remembered."}
          </span>
        </div>
      </div>
    </Group>
  );
}

/** One titled block of related settings; fields inside lay out two per row. */
function ModelSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // A value saved before this list existed still shows, rather than silently resetting.
  const known = MODEL_OPTIONS.some((option) => option.id === value);
  return (
    <Select value={value} onValueChange={onChange}>
      {MODEL_OPTIONS.map((option) => (
        <SelectItem key={option.id} value={option.id}>
          {option.label} · {option.hint}
        </SelectItem>
      ))}
      {!known && value && <SelectItem value={value}>{value}</SelectItem>}
    </Select>
  );
}


const PROMPT_GROUPS = ["Session", "Pull request", "Findings", "Threads"];

/**
 * The words every button sends, editable. The same string is what the hover
 * shows, what the confirmation shows and what the agent is given, so a rewrite
 * here changes all three at once. `{placeholder}` is filled in when the prompt
 * is built; drop one and that information simply stops being sent.
 */
function Prompts({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const actions = useStore((state) => state.actions);
  const setActions = useStore((state) => state.setActions);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // The dialog decides whether a click outside may close it, so what is open
  // and edited here has to reach it. Leaving the tab reports it clean again:
  // the editor is gone with it.
  const editing = actions.find((action) => action.id === openId);
  const dirty = Boolean(editing) && draft !== editing?.template;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const open = (action: ActionTemplate) => {
    setOpenId(action.id === openId ? null : action.id);
    setDraft(action.template);
  };

  const save = async (action: ActionTemplate) => {
    setSaving(true);
    try {
      const result = await api.savePrompt(action.id, draft);
      setActions(result.actions);
      setOpenId(null);
    } finally {
      setSaving(false);
    }
  };

  const reset = async (action: ActionTemplate) => {
    setSaving(true);
    try {
      const result = await api.resetPrompt(action.id);
      setActions(result.actions);
      setDraft(result.actions.find((item) => item.id === action.id)?.template ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">
        Rewriting a template changes what the button sends everywhere: the hover, the confirmation, and the agent.
        Keep the <code className="font-mono">{"{placeholder}"}</code> pieces you still want filled in; what you drop
        stops being sent. Settings &gt; Prompts is for changing them for good, the pencil in a confirmation is for
        changing one request.
      </p>

      {PROMPT_GROUPS.map((group) => {
        const inGroup = actions.filter((action) => action.category === group);
        if (!inGroup.length) return null;
        return (
          <div key={group}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <div className="space-y-2">
              {inGroup.map((action) => (
                <Accordion
                  key={action.id}
                  title={action.label}
                  subtitle={action.where}
                  badge={
                    <>
                      {action.overridden && <StatusBadge tone="warning">rewritten</StatusBadge>}
                      {action.writes && <StatusBadge tone="off">writes to the pull request</StatusBadge>}
                    </>
                  }
                >
                  <div className="flex items-center justify-end gap-2">
                    {action.overridden && (
                      <Button onClick={() => reset(action)} disabled={saving}>
                        <RotateCcw size={12} /> Restore the default
                      </Button>
                    )}
                    <Button onClick={() => open(action)}>
                      <Pencil size={12} /> {openId === action.id ? "Close" : "Edit"}
                    </Button>
                  </div>

                  {openId === action.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        rows={12}
                        value={draft}
                        className="font-mono text-[11px] leading-relaxed"
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Placeholders in the default: {placeholdersOf(action.defaultTemplate ?? action.template)}
                        </span>
                        <Button
                          variant="primary"
                          className="ml-auto"
                          onClick={() => save(action)}
                          disabled={saving || !draft.trim()}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                      {action.template}
                    </pre>
                  )}
                </Accordion>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The names a template may fill in, so a rewrite can keep the ones it needs. */
function placeholdersOf(template: string): string {
  const names = [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))];
  return names.length ? names.map((name) => `{${name}}`).join(" ") : "none";
}

/** Review criteria live in the tool, not in a skill, so they are edited here. */
function Profiles({
  profiles,
  setProfiles,
  selectedId,
  setSelectedId,
  draft,
  setDraft,
  save,
}: {
  profiles: Profile[];
  setProfiles: (profiles: Profile[]) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
  draft: Profile | undefined;
  setDraft: (profile: Profile) => void;
  save: (profile: Profile) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  if (!draft) return null;

  return (
    <div className="divide-y">
      <div className="pb-3">
        <div className="flex items-center gap-2">
          <div>
            <div className="text-xs font-medium">Selected profile</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Everything below belongs to it. Switching swaps the fields.
            </p>
          </div>
          <Button variant="foreground" className="ml-auto shrink-0" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add profile
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <Select value={selectedId} onValueChange={setSelectedId}>
              {profiles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <Button
            onClick={async () => {
              const { ok } = await confirm({
                title: "Duplicate profile",
                description: `"${draft.name} copy" is created with everything this profile has, and becomes the one you are editing.`,
                noteLabel: null,
                confirmLabel: "Duplicate",
              });
              if (!ok) return;
              const id = `profile-${Date.now().toString(36)}`;
              await save({ ...draft, id, name: `${draft.name} copy` });
              setSelectedId(id);
            }}
          >
            Duplicate
          </Button>
          <Button onClick={() => downloadProfile(draft)}>Export</Button>
          {profiles.length > 1 && (
            <Button
              variant="destructive"
              onClick={async () => {
                const { ok } = await confirm({
                  title: "Delete profile",
                  description: `"${draft.name}" and its dimensions are gone for good. Sessions already reviewed with it keep their findings.`,
                  noteLabel: null,
                  confirmLabel: "Delete",
                });
                if (!ok) return;
                const next = await api.deleteProfile(draft.id);
                setProfiles(next);
                setSelectedId(next[0]?.id ?? "default");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <ProfileForm draft={draft} setDraft={setDraft} />

      {adding && (
        <ProfileDialog onClose={() => setAdding(false)} onSaved={(profile) => setSelectedId(profile.id)} />
      )}
    </div>
  );
}

/**
 * When the global copy was last written. By hand rather than by locale, as the
 * session list is, so a date is never an ambiguous month/day order.
 */
function savedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())} ${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}

/** What each part of a backup covers, for the reviewer ticking the boxes. */
const BACKUP_LABELS: Record<BackupSection, { label: string; hint: string }> = {
  settings: {
    label: "Settings",
    hint: "Languages, models, permission mode, review depth, worktree pruning.",
  },
  profiles: { label: "Profiles", hint: "Every review profile with its dimensions, context and filters." },
  prompts: { label: "Prompts", hint: "The action templates that were rewritten, if any." },
};

/**
 * The configuration as a file, and the way back to a fresh install. Only what
 * Settings itself configures travels: sessions and their findings are a record
 * of work, and nothing here touches them. Where the repos sit on this disk and
 * which host was last used stay behind too, so a file written on one machine
 * cannot point another at a path that is not there.
 */
function Backup() {
  const confirm = useConfirm();
  const { setSettings, setProfiles, setActions } = useStore();
  const [sections, setSections] = useState<BackupSection[]>([...BACKUP_SECTIONS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // What the machine-wide copy holds, so the section can say whether there is
  // anything to sync from rather than offering a button that only fails.
  const [global, setGlobal] = useState<GlobalBackup | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void api
      .globalBackup()
      .then((state) => current && setGlobal(state))
      .catch(() => current && setGlobal(null));
    return () => { current = false; };
  }, []);

  const toggle = (section: BackupSection, on: boolean) =>
    setSections((current) =>
      BACKUP_SECTIONS.filter((item) => (item === section ? on : current.includes(item))),
    );

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      setDone(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = () =>
    run(async () => {
      const file = await api.backup(sections);
      const name = `review-hub-settings-${file.exportedAt.slice(0, 10)}.json`;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      return `Saved ${name}.`;
    });

  const importFile = async (chosen: File) => {
    setError("");
    setDone("");
    let file: BackupFile;
    try {
      file = JSON.parse(await chosen.text()) as BackupFile;
    } catch {
      setError("That is not valid JSON.");
      return;
    }
    const inFile = BACKUP_SECTIONS.filter((section) => file?.[section] !== undefined);
    const applying = sections.filter((section) => inFile.includes(section));
    if (!applying.length) {
      setError(
        inFile.length
          ? `That file has ${inFile.join(" and ")} in it, which is not what is ticked.`
          : "That file has nothing in it to import.",
      );
      return;
    }
    const { ok } = await confirm({
      title: "Import settings",
      description: `${applying
        .map((section) => BACKUP_LABELS[section].label.toLowerCase())
        .join(", ")} are replaced by what ${chosen.name} says, not merged with what is here. Sessions and their findings are untouched, and so are the repos registered on this machine.`,
      noteLabel: null,
      confirmLabel: "Import",
    });
    if (!ok) return;
    await run(async () => {
      const result = await api.importBackup(file, applying);
      setSettings(result.settings);
      setProfiles(result.profiles);
      setActions(result.actions);
      return `Imported ${result.applied.join(", ")}.`;
    });
  };

  const named = (picked: BackupSection[]) =>
    picked.map((section) => BACKUP_LABELS[section].label.toLowerCase()).join(", ");

  const syncTo = async () => {
    const { ok } = await confirm({
      title: "Sync to the global settings",
      description: `The ${named(sections)} of this project are written to ${global?.path ?? "the global copy"}, replacing what is there. Other projects read it only when they ask to, so nothing of theirs changes now.`,
      noteLabel: null,
      confirmLabel: "Sync to global",
    });
    if (!ok) return;
    await run(async () => {
      const state = await api.syncToGlobal(sections);
      setGlobal(state);
      return `Saved ${named(state.sections)} to the global settings.`;
    });
  };

  const syncFrom = async () => {
    const applying = sections.filter((section) => global?.sections.includes(section));
    if (!applying.length) {
      setError(
        global?.sections.length
          ? `The global copy has ${named(global.sections)} in it, which is not what is ticked.`
          : "Nothing has been saved to the global settings on this machine yet.",
      );
      return;
    }
    const { ok } = await confirm({
      title: "Sync from the global settings",
      description: `The ${named(applying)} of this project are replaced by what the global copy says, not merged with what is here. Sessions and their findings are untouched, and so are the repos registered on this machine.`,
      noteLabel: null,
      confirmLabel: "Sync from global",
    });
    if (!ok) return;
    await run(async () => {
      const result = await api.syncFromGlobal(applying);
      setSettings(result.settings);
      setProfiles(result.profiles);
      setActions(result.actions);
      return `Took ${result.applied.join(", ")} from the global settings.`;
    });
  };

  const restore = async () => {
    const { ok } = await confirm({
      title: "Restore the default settings",
      description:
        "Every setting goes back to what a fresh install has, edited profiles are gone and the built-in ones are the list again, and every rewritten prompt gets its built-in wording back. Sessions and their findings stay, and so do the repos registered on this machine.",
      noteLabel: null,
      confirmLabel: "Restore the defaults",
    });
    if (!ok) return;
    await run(async () => {
      const result = await api.resetConfig();
      setSettings(result.settings);
      setProfiles(result.profiles);
      setActions(result.actions);
      return "Everything is back to the defaults.";
    });
  };

  return (
    <div className="divide-y">
      {/* The tick boxes are the settings of these two buttons - what an export
          writes, and what an import may replace - so they are one section. */}
      <Group
        title="Export and import"
        description="One JSON file, written and read back by this dialog. What is ticked is what it carries."
      >
        <div className="col-span-2 space-y-3">
          <div className="space-y-2">
            {BACKUP_SECTIONS.map((section) => (
              <div key={section}>
                <Checkbox
                  label={BACKUP_LABELS[section].label}
                  checked={sections.includes(section)}
                  onCheckedChange={(on) => toggle(section, on)}
                />
                <p className="ml-6 text-[11px] text-muted-foreground">{BACKUP_LABELS[section].hint}</p>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Where each repo sits on this disk, and the host last used, are never in the file: they are facts about
              this machine rather than settings.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="foreground" onClick={exportFile} disabled={busy || !sections.length}>
              <Download size={12} /> Export to a file
            </Button>
            <Button onClick={() => picker.current?.click()} disabled={busy || !sections.length}>
              <Upload size={12} /> Import from a file
            </Button>
            <input
              ref={picker}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file twice in a row still fires.
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
            {done && <span className="text-[11px] text-muted-foreground">{done}</span>}
            {error && <span className="text-[11px] text-destructive">{error}</span>}
          </div>
        </div>
      </Group>

      {/* The same document, kept once for the machine: what a project syncs to
          when it has settled on something, and from on its first start. */}
      <Group
        title="Global settings"
        description="One copy for this machine, outside any repo. A project takes from it or gives to it; neither happens on its own."
      >
        <div className="col-span-2 space-y-3">
          <div className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
            <div className="font-mono text-foreground">{global?.path ?? "…"}</div>
            <div className="mt-0.5">
              {global?.exists
                ? `Holds ${named(global.sections)}${global.savedAt ? `, saved ${savedLabel(global.savedAt)}` : ""}.`
                : "Nothing saved here yet. Sync to it once, and every other project can start from it."}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="foreground" onClick={syncTo} disabled={busy || !sections.length}>
              <CloudUpload size={12} /> Sync to global
            </Button>
            <Button onClick={syncFrom} disabled={busy || !sections.length || !global?.exists}>
              <CloudDownload size={12} /> Sync from global
            </Button>
          </div>
        </div>
      </Group>

      <Group
        title="Restore the defaults"
        description="Settings, profiles and prompts, all at once and regardless of what is ticked above. Sessions and their findings stay."
      >
        <div className="col-span-2">
          <Button variant="destructive" onClick={restore} disabled={busy}>
            <RotateCcw size={12} /> Restore the default settings
          </Button>
        </div>
      </Group>
    </div>
  );
}
