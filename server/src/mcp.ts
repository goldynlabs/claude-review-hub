import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { emit } from "./events.js";
import { addVerdict, createFinding, getFinding, setFindingStatus } from "./review/findings.js";
import { findingSchema, verdictSchema } from "./review/schema.js";
import { detectContext, PROVIDER_KINDS, type ProviderKind } from "./providers/index.js";
import { findSessionPr, registerPr, type SessionPr } from "./sessions.js";

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export interface ToolContext {
  sessionId: string;
  /** The agent turn these tools belong to; stamped onto anything reported. */
  runId?: string;
}

/** Every PR-scoped tool resolves the PR the agent registered earlier. */
function prOf(context: ToolContext, prId?: number): SessionPr {
  const pr = findSessionPr(context.sessionId, prId);
  if (!pr) {
    throw new Error(
      prId
        ? `PR ${prId} has not been registered in this session yet. Call mcp__dashboard__register_pr first.`
        : "No pull request in this session yet. Register one first, or pass prId.",
    );
  }
  return pr;
}

/**
 * The host is normally named by the agent, since the skill it followed knows
 * which one it drove. When it is not, the checkout answers it: its origin
 * remote is the same thing the dashboard reads on boot.
 */
async function providerOf(input: { provider?: ProviderKind; repoPath?: string }): Promise<ProviderKind> {
  if (input.provider) return input.provider;
  if (input.repoPath) {
    const context = await detectContext(input.repoPath, true).catch(() => null);
    if (context?.source === "git-remote" && context.provider) return context.provider;
  }
  return "azure";
}


/**
 * What the agent tells the dashboard about work it did itself. The panels are
 * built from these calls, so anything not reported here is invisible.
 */
export function dashboardTools(context: ToolContext) {
  return [
      tool(
        "register_pr",
        "Report a pull request you resolved and prepared. This draws its tab, its changed-file list and its diff panel. Call it again to update what you know.",
        {
          prId: z.number().int(),
          provider: z
            .enum(PROVIDER_KINDS as [ProviderKind, ...ProviderKind[]])
            .optional()
            .describe("Which host this pull request lives on. Omit it only if you cannot tell: it is then read from the checkout's origin remote."),
          org: z.string().describe("Azure DevOps organisation, or GitHub owner"),
          project: z.string().optional().describe("Azure DevOps team project. GitHub has no such level: leave it out"),
          repo: z.string(),
          repoPath: z.string().describe("Absolute path of the local checkout the worktree came from"),
          worktreePath: z.string().describe("Absolute path of the detached worktree you created"),
          sourceBranch: z.string(),
          targetBranch: z.string(),
          title: z.string().optional(),
          author: z.string().optional(),
          prStatus: z.string().optional(),
          headSha: z.string().optional(),
          baseSha: z.string().optional(),
          files: z
            .array(
              z.object({
                file: z.string(),
                status: z.enum(["added", "modified", "deleted", "renamed"]),
                additions: z.number().int(),
                deletions: z.number().int(),
              }),
            )
            .optional()
            .describe("From git diff --numstat, one entry per changed file"),
        },
        async (args) => {
          const provider = await providerOf(args);
          const pr = registerPr(context.sessionId, { ...args, provider, project: args.project ?? "" });
          return ok({ sessionPrId: pr.id, prId: pr.prId, provider: pr.provider, registered: true });
        },
      ),
      tool(
        "report_finding",
        "Report one review finding, as soon as you are sure of it. Never write findings as prose: an unreported finding cannot be filtered, challenged or posted.",
        { prId: z.number().int().optional(), ...findingSchema.shape },
        async ({ prId, ...finding }) => {
          const pr = prOf(context, prId);
          const created = createFinding(context.sessionId, pr.id, finding, context.runId);
          return ok({ id: created.id, recorded: true });
        },
      ),
      tool(
        "report_verdict",
        "Report the outcome of challenging or re-checking an existing finding.",
        { findingId: z.string(), ...verdictSchema.shape },
        async (args) => {
          const confidence = args.stillValid ? args.confidence : Math.min(args.confidence, 0.2);
          addVerdict(args.findingId, "challenge", confidence, args.reason, args);
          emit(context.sessionId, "finding.updated", getFinding(args.findingId));
          return ok({ findingId: args.findingId, confidence });
        },
      ),
      tool(
        "mark_finding_resolved",
        "Record that a finding is dealt with, after closing its comment thread if it had one (fixed on Azure DevOps, resolved on GitHub). The dashboard then takes it off the open list.",
        { findingId: z.string() },
        async (args) => {
          const finding = setFindingStatus(args.findingId, "resolved");
          return ok({ findingId: finding.id, status: finding.status });
        },
      ),
      tool(
        "mark_finding_posted",
        "Record that you posted a finding to the pull request, after doing it yourself with the host's CLI. Without this the dashboard still shows it as unposted and it can be posted twice.",
        {
          findingId: z.string(),
          threadId: z
            .number()
            .int()
            .optional()
            .describe("Azure DevOps thread id, or on GitHub the id of the review comment that starts the conversation"),
        },
        async (args) => {
          const finding = setFindingStatus(args.findingId, "posted", args.threadId);
          return ok({ findingId: finding.id, status: finding.status });
        },
      ),
  ];
}

/** The dashboard's own tools, as an MCP server the agent can call. */
export function dashboardMcpServer(context: ToolContext) {
  return createSdkMcpServer({ name: "dashboard", version: "1.0.0", tools: dashboardTools(context) });
}
