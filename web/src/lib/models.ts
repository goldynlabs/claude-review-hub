/**
 * Model ids as documented by the claude-api reference. The ids are complete as
 * written: never append a date suffix.
 */
export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Best judgement, 1M context" },
  { id: "claude-opus-5", label: "Opus 5", hint: "Previous Opus, 1M context" },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Cheaper sweep over a diff" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest, 200K context" },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable, highest cost" },
  { id: "claude-fable-5", label: "Fable 5", hint: "Previous Fable, 1M context" },
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Older Opus, 1M context" },
  { id: "claude-opus-4-7", label: "Opus 4.7", hint: "Older Opus, 1M context" },
  { id: "claude-opus-4-6", label: "Opus 4.6", hint: "Older Opus, 1M context" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "Older Sonnet, 1M context" },
];

export function modelLabel(id: string): string {
  return MODEL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
