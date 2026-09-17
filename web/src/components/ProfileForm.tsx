import { useRef, useState } from "react";
import { Check, Copy, Download, Pencil, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useConfirm } from "./Confirm";
import { useStore } from "../lib/store";
import type { Dimension, Profile } from "../lib/types";
import { Accordion } from "./ui/Accordion";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
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
    useProjectRules: true,
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
 * What a pasted JSON may look like: the array itself, or the whole profile-ish
 * object it was wrapped in. Only the label and the prompt are read; the id is
 * seeded from the label and made unique against what is already there, because
 * two dimensions with one id would edit as one, and an import is always asked
 * for.
 */
export function parseDimensions(text: string, existing: Dimension[]): Dimension[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
        <div className="col-span-2">
          <Checkbox
            label="Review against the project's own rule files"
            checked={draft.useProjectRules}
            onCheckedChange={(checked) => setDraft({ ...draft, useProjectRules: checked })}
          />
        </div>
      </Group>

      <div className="space-y-2 border-t py-4">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dimensions</div>
          <Button className="ml-auto" onClick={copyPrompt}>
            {copied ? <Check size={12} /> : <Copy size={12} />} Copy prompt
          </Button>
          <Button onClick={() => setImporting(true)}>
            <Download size={12} /> Import JSON
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          What each reviewer is asked to look for. Disabled ones are skipped.
        </p>

        {/* Copy the prompt, fill in what you want reviewed wherever you run it,
            then bring the JSON back through this dialog. */}
        {importing && (
          <ImportDimensionsDialog
            existing={draft.dimensions}
            onClose={() => setImporting(false)}
            onImport={(added) => setDraft({ ...draft, dimensions: [...draft.dimensions, ...added] })}
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
    </>
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
      <ProfileForm draft={draft} setDraft={setDraft} />
    </Modal>
  );
}
