import { z } from "zod";

export const severitySchema = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof severitySchema>;

export const evidenceSchema = z.object({
  kind: z.enum(["code", "rule", "trace", "context"]).describe(
    "code = the changed lines themselves, rule = a project rule or spec being broken, trace = call sites or blast radius, context = anything else",
  ),
  file: z.string().optional(),
  lineStart: z.number().int().optional(),
  lineEnd: z.number().int().optional(),
  snippet: z.string().optional().describe("The exact code being cited, verbatim"),
  source: z.string().optional().describe("Rule file, spec, or document the quote comes from"),
  quote: z.string().optional().describe("The exact text of the rule being applied"),
  note: z.string().optional(),
});

export const findingSchema = z.object({
  file: z.string().describe("Repo-relative path of the file the finding is in"),
  line: z.number().int().optional().describe("1-indexed line in the PR head"),
  endLine: z.number().int().optional(),
  dimension: z.string().describe("Id of the review dimension this finding came from"),
  severity: severitySchema,
  title: z.string().max(120).describe("One line, the claim itself"),
  detail: z.string().describe("Why it is wrong and what breaks because of it"),
  suggestedFix: z.string().optional(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How sure you are this is a real defect. Below 0.5 means you suspect it but could not prove it from the code you read.",
    ),
  evidence: z
    .array(evidenceSchema)
    .min(1)
    .describe("At least one concrete anchor. A finding with no evidence is not reportable."),
});

export type FindingInput = z.infer<typeof findingSchema>;

export const verdictSchema = z.object({
  stillValid: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().describe("What in the code confirmed or refuted the finding"),
});

export type VerdictInput = z.infer<typeof verdictSchema>;

/* -------------------------------------------------------------- profiles */

export const dimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean().default(true),
  prompt: z.string().describe("What this dimension asks the reviewer to look for"),
});

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  dimensions: z.array(dimensionSchema),
  /** Free-form context typed in the UI: a spec, a ticket, "focus on the auth flow". */
  context: z.string().default(""),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  /** Load the target project's own rule files as the review standard. */
  useProjectRules: z.boolean().default(true),
  severityFloor: severitySchema.default("suggestion"),
  /** Findings below this confidence are stored but hidden by default. */
  confidenceFloor: z.number().min(0).max(1).default(0),
});

export type Profile = z.infer<typeof profileSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;
