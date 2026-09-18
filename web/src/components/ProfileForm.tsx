import { useRef, useState } from "react";
import { Check, Copy, Download, ListChecks, Pencil, Sparkles, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useConfirm } from "./Confirm";
import { useStore } from "../lib/store";
import type { Dimension, Profile } from "../lib/types";
import { Accordion } from "./ui/Accordion";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Empty } from "./ui/Empty";
import { Field, Group } from "./ui/Field";
import { Input } from "./ui/Input";
import { Modal } from "./ui/Modal";
import { StatusBadge } from "./ui/StatusBadge";
import { Textarea } from "./ui/Textarea";

/** What a profile is before anything has been asked of it. */
export function blankProfile(): Profile {
  return {
    id: `profile-${Date.now().toString(36)}`,
    name: "",
    dimensions: [],
    context: "",
    include: [],
    exclude: [],
    severityFloor: "suggestion",
    confidenceFloor: 0,
  };
}

/**
 * Pasted into any assistant to get the JSON the import below accepts. The part
 * the reviewer has to say for themselves stays a placeholder, so what is copied
 * is a form to fill in rather than a request for someone else's review.
 */
export const DIMENSIONS_PROMPT = `Write the review dimensions for a pull request review tool.

Answer with JSON only, no prose and no code fence, as an array of objects:

[
  {
    "label": "Short name shown in the UI",
    "prompt": "What this reviewer is asked to look for, and what evidence to cite for a finding."
  }
]

One object per concern. Keep each prompt concrete: name the kinds of defect to
look for and what the reviewer must point at to report one.

What I want reviewed: {what you want reviewed}`;

/**
 * The same wording, aimed at a Claude rather than at whatever the reviewer
 * pastes it into: their ask fills the placeholder, and the dimensions they
 * already have travel with it, so "drop the security one" or "make the
 * correctness one stricter" is a thing they can say. There is one prompt for
 * this, built here, and the confirmation shows it before it is sent.
 */
export function dimensionsPrompt(ask: string, existing: Dimension[]): string {
  const filled = DIMENSIONS_PROMPT.replace("{what you want reviewed}", ask.trim());
  if (!existing.length) return filled;
  return [
    filled,
    "",
    "The profile already has the dimensions below. Answer with the whole list I should end up with, not only the new ones: keep what still fits, change what I asked about, leave out what I asked to remove.",
    "",
    "```json",
    JSON.stringify(
      existing.map(({ id, label, prompt }) => ({ id, label, prompt })),
      null,
      2,
    ),
    "```",
  ].join("\n");
}

/** A model told to answer with JSON only still wraps it in a fence half the time. */
function unfence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * What a pasted JSON may look like: the array itself, or the whole profile-ish
 * object it was wrapped in. Only the label and the prompt are read; the id is
 * seeded from the label and made unique against what is already there, because
 * two dimensions with one id would edit as one, and an import is always asked
 * for.
 */
export function parseDimensions(text: string, existing: Dimension[]): Dimension[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { dimensions?: unknown })?.dimensions)
      ? ((parsed as { dimensions: unknown[] }).dimensions)
      : null;
  if (!list) throw new Error("Expected an array of dimensions, or an object with a dimensions array.");
  if (!list.length) throw new Error("No dimensions in there.");

  const taken = new Set(existing.map((dimension) => dimension.id));
  return list.map((item, index) => {
    const value = item as Partial<Dimension>;
    const label = typeof value.label === "string" ? value.label.trim() : "";
    const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
    if (!label) throw new Error(`Dimension ${index + 1} has no label.`);
    if (!prompt) throw new Error(`"${label}" has no prompt.`);
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `dim-${index + 1}`;
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return { id, label, prompt, enabled: true };
  });
}

/**
 * A profile leaving the tool: everything it is except its id, which belongs to
 * the machine it was created on. Importing it elsewhere mints a fresh one.
 */
export function profileJson(profile: Profile): string {
  const { id: _id, ...rest } = profile;
  return JSON.stringify(rest, null, 2);
}

/** Saved through the browser, so an export needs nothing from the server. */
export function downloadProfile(profile: Profile): void {
  const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
  const url = URL.createObjectURL(new Blob([profileJson(profile)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The other end of the export: a whole profile, not only its dimensions. Every
 * field falls back to what a blank profile has, so a file written by an older
 * version, or by hand, still imports.
 */
export function parseProfile(text: string): Profile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    throw new Error("That is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a profile object.");
  }
  const value = parsed as Partial<Profile>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) throw new Error("That profile has no name.");

  const blank = blankProfile();
  const strings = (input: unknown, fallback: string[]) =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : fallback;
  return {
    ...blank,
    name,
    dimensions: parseDimensions(JSON.stringify(value.dimensions ?? []), []),
    context: typeof value.context === "string" ? value.context : blank.context,
    include: strings(value.include, blank.include),
    exclude: strings(value.exclude, blank.exclude),
    severityFloor: value.severityFloor ?? blank.severityFloor,
    confidenceFloor: typeof value.confidenceFloor === "number" ? value.confidenceFloor : blank.confidenceFloor,
  };
}

/**
 * The fields of a profile, with no opinion about where they live: Settings >
 * Profiles edits an existing one with them, and ProfileDialog creates one. A
 * field added here reaches both.
 */
export function ProfileForm({ draft, setDraft }: { draft: Profile; setDraft: (profile: Profile) => void }) {
  const confirm = useConfirm();
  // View by default, like the other settings pages: the prompt is read until
  // someone asks to change it.
  const [editing, setEditingDimension] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(DIMENSIONS_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; nothing more we can do without a text field to select.
    }
  };

  return (
    <>
      <Group title="Profile">
        <Field label="Name">
          <Input
            value={draft.name}
            placeholder="What to call this profile"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <div className="col-span-2">
          <Field
            label="Context"
            hint="Pasted spec, ticket, or anything the reviewer should assume. Applies to every run with this profile."
          >
            <Textarea
              rows={3}
              value={draft.context}
              onChange={(event) => setDraft({ ...draft, context: event.target.value })}
            />
          </Field>
        </div>
      </Group>

      <div className="space-y-2 border-t py-4">
        {/* Title and its line are one block, so the gap between them is the
            same tight one the other settings headers use. */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dimensions</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            What each reviewer is asked to look for. Disabled ones are skipped.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={copyPrompt}>
            {copied ? <Check size={12} /> : <Copy size={12} />} Copy prompt
          </Button>
          <Button onClick={() => setImporting(true)}>
            <Download size={12} /> Import JSON
          </Button>
          <Button variant="foreground" onClick={() => setGenerating(!generating)}>
            <Sparkles size={12} /> Generate
          </Button>
        </div>

        {/* Say what you want reviewed and a Claude of its own writes the
            dimensions. What it is sent is the prompt the confirmation shows,
            with whatever is already in the profile attached, so an ask can be
            "add", "reword" or "drop this one" alike. */}
        {generating && (
          <GenerateDimensions
            existing={draft.dimensions}
            onGenerated={(dimensions) => {
              setDraft({ ...draft, dimensions });
              setGenerating(false);
            }}
          />
        )}

        {/* Copy the prompt, fill in what you want reviewed wherever you run it,
            then bring the JSON back through this dialog. */}
        {importing && (
          <ImportDimensionsDialog
            existing={draft.dimensions}
            onClose={() => setImporting(false)}
            onImport={(added) => setDraft({ ...draft, dimensions: [...draft.dimensions, ...added] })}
          />
        )}

        {!draft.dimensions.length && (
          <Empty
            icon={ListChecks}
            title="Nothing to review yet."
            hint="Add a dimension, or import the JSON that Copy prompt asks for. A profile with none of them cannot be reviewed against."
            className="py-6"
          />
        )}

        {draft.dimensions.map((dimension, index) => {
          const patch = (fields: Partial<(typeof draft.dimensions)[number]>) => {
            const dimensions = [...draft.dimensions];
            dimensions[index] = { ...dimension, ...fields };
            setDraft({ ...draft, dimensions });
          };
          return (
            <Accordion
              key={dimension.id}
              title={dimension.label || dimension.id}
              subtitle={dimension.id}
              badge={!dimension.enabled && <StatusBadge tone="off">skipped</StatusBadge>}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  label="Ask for this one"
                  checked={dimension.enabled}
                  onCheckedChange={(checked) => patch({ enabled: checked })}
                />
                <Button
                  className="ml-auto"
                  onClick={() => setEditingDimension(editing === dimension.id ? null : dimension.id)}
                >
                  <Pencil size={12} /> {editing === dimension.id ? "Close" : "Edit"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    const { ok } = await confirm({
                      title: "Remove dimension",
                      description: `"${dimension.label || dimension.id}" will no longer be reviewed in this profile.`,
                      noteLabel: null,
                      confirmLabel: "Remove",
                    });
                    if (!ok) return;
                    setDraft({ ...draft, dimensions: draft.dimensions.filter((_, i) => i !== index) });
                  }}
                >
                  Remove
                </Button>
              </div>

              {editing === dimension.id ? (
                <div className="mt-2 space-y-2">
                  <Input
                    value={dimension.label}
                    placeholder="What to call it"
                    onChange={(event) => patch({ label: event.target.value })}
                  />
                  <Textarea
                    rows={4}
                    value={dimension.prompt}
                    placeholder="What this reviewer is asked to look for."
                    onChange={(event) => patch({ prompt: event.target.value })}
                  />
                </div>
              ) : (
                <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                  {dimension.prompt || "Nothing asked for yet."}
                </p>
              )}
            </Accordion>
          );
        })}
        <div className="flex justify-end">
          <Button
            onClick={() =>
              setDraft({
                ...draft,
                dimensions: [
                  ...draft.dimensions,
                  { id: `dim-${draft.dimensions.length + 1}`, label: "New dimension", enabled: true, prompt: "" },
                ],
              })
            }
          >
            Add dimension
          </Button>
        </div>
      </div>

      <Group title="Scope">
        <Field label="Exclude globs" hint="Comma separated.">
          <Input
            value={draft.exclude.join(", ")}
            onChange={(event) =>
              setDraft({
                ...draft,
                exclude: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="Include globs" hint="Empty means every changed file.">
          <Input
            value={draft.include.join(", ")}
            onChange={(event) =>
              setDraft({
                ...draft,
                include: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
              })
            }
          />
        </Field>
      </Group>
    </>
  );
}

/**
 * The generate box: inline, because what is typed here is one line of intent,
 * not a document. The prompt it will send is the one `dimensionsPrompt` builds
 * and the confirmation shows, so this box is an ask and never the whole
 * request. The answer replaces the list, which is why the existing dimensions
 * are sent with it: the reviewer is meant to be able to say "keep those two".
 */
function GenerateDimensions({
  existing,
  onGenerated,
}: {
  existing: Dimension[];
  onGenerated: (dimensions: Dimension[]) => void;
}) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No confirmation: nothing here reaches the agent, the pull request or the
  // profile. It answers into the list below, which is reviewed and saved by
  // hand like anything else typed into this form.
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const { text } = await api.generateDimensions(dimensionsPrompt(ask, existing));
      onGenerated(parseDimensions(text, []));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md bg-muted p-2">
      <Textarea
        rows={3}
        autoFocus
        value={ask}
        disabled={busy}
        placeholder={
          existing.length
            ? "What to change: add a concurrency dimension, make Security stricter about auth, drop Project rules."
            : "What you want reviewed: a multi-tenant billing API, React frontend with a design system, a Terraform module."
        }
        onChange={(event) => {
          setAsk(event.target.value);
          setError(null);
        }}
      />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {busy ? "Writing them now." : "Answers into the list below; nothing is saved until you save the profile."}
        </span>
        <Button variant="foreground" className="ml-auto" disabled={busy || !ask.trim()} onClick={submit}>
          <Sparkles size={12} /> {busy ? "Generating" : "Generate"}
        </Button>
      </div>
      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/**
 * Import is its own dialog rather than a panel in the middle of the dimension
 * list: a pasted file is long, and the list it is going into should not scroll
 * away underneath it. A file only fills the box below, so what is imported is
 * always the text you can see.
 */
function ImportDimensionsDialog({
  existing,
  onClose,
  onImport,
}: {
  existing: Dimension[];
  onClose: () => void;
  onImport: (dimensions: Dimension[]) => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  };

  const submit = () => {
    try {
      onImport(parseDimensions(text, existing));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Import dimensions"
      description="Upload a JSON file or paste it. They are added to the profile, nothing is replaced."
      maxWidth="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={submit}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              // Cleared so picking the same file again still fires a change.
              event.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload size={12} /> Choose file
          </Button>
          <span className="truncate text-[11px] text-muted-foreground">
            {fileName ?? "No file chosen. You can paste below instead."}
          </span>
        </div>

        <Field
          label="JSON"
          hint="An array of dimensions, or an object with a dimensions array. Copy prompt gives you the wording that produces it."
        >
          <Textarea
            rows={12}
            className="font-mono text-[11px]"
            placeholder={'[{ "label": "Tenant isolation", "prompt": "..." }]'}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </Field>
        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * The whole profile this time, not only its dimensions: a file exported from
 * Settings > Profiles fills the New profile form, which is then reviewed and
 * saved like any other. Nothing is written until Create profile is pressed.
 */
function ImportProfileDialog({ onClose, onImport }: { onClose: () => void; onImport: (profile: Profile) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  };

  const submit = () => {
    try {
      onImport(parseProfile(text));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Import profile"
      description="Upload a profile exported from Settings > Profiles, or paste it. It fills the form; nothing is saved yet."
      maxWidth="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={submit}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              // Cleared so picking the same file again still fires a change.
              event.target.value = "";
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload size={12} /> Choose file
          </Button>
          <span className="truncate text-[11px] text-muted-foreground">
            {fileName ?? "No file chosen. You can paste below instead."}
          </span>
        </div>

        <Field label="JSON" hint="A profile object: its name, dimensions, context and the rest.">
          <Textarea
            rows={12}
            className="font-mono text-[11px]"
            placeholder={'{ "name": "Backend", "dimensions": [...] }'}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </Field>
        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * The same fields in their own modal, for creating a profile without going
 * through Settings. `initial` decides which of the two it is.
 */
export function ProfileDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Profile;
  onClose: () => void;
  onSaved?: (profile: Profile) => void;
}) {
  const { setProfiles } = useStore();
  const creating = !initial;
  const [draft, setDraft] = useState<Profile>(initial ?? blankProfile());
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  // A profile with no name or nothing to look for cannot be reviewed against,
  // so it is not saved at all rather than saved and useless.
  const missing = !draft.name.trim() ? "a name" : !draft.dimensions.length ? "at least one dimension" : null;

  const submit = async () => {
    if (missing) return;
    setSaving(true);
    try {
      const saved = await api.saveProfile({ ...draft, name: draft.name.trim() });
      setProfiles(await api.profiles());
      onSaved?.(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={creating ? "New profile" : "Edit profile"}
      description="The criteria a review run is asked to apply."
      maxWidth="max-w-2xl"
      footer={
        <>
          {missing && (
            <span className="mr-auto self-center text-[11px] text-muted-foreground">Needs {missing}.</span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || Boolean(missing)} onClick={submit}>
            {creating ? "Create profile" : "Save profile"}
          </Button>
        </>
      }
    >
      {/* Creating only: on an existing profile an import would silently replace
          every field of something already saved. */}
      {creating && (
        <div className="flex justify-end">
          <Button onClick={() => setImporting(true)}>
            <Upload size={12} /> Import
          </Button>
        </div>
      )}
      <ProfileForm draft={draft} setDraft={setDraft} />
      {importing && (
        <ImportProfileDialog
          onClose={() => setImporting(false)}
          // The id stays the one this dialog minted, so an imported profile is
          // a new one here rather than an overwrite of wherever it came from.
          onImport={(profile) => setDraft({ ...profile, id: draft.id })}
        />
      )}
    </Modal>
  );
}
