import { useStore } from "./store";
import type { Connection, ProviderKind } from "./types";

export type HostWords = Pick<Connection, "label" | "cli" | "threadStates" | "resolvedStates">;

/**
 * What to say about a host before the server has answered, and for a host that
 * is not installed on this machine: a pull request reviewed earlier still has
 * to render its own words. The server's answer always wins over this.
 */
const FALLBACK: Record<ProviderKind, HostWords> = {
  azure: {
    label: "Azure DevOps",
    cli: "az",
    threadStates: [
      { value: "active", label: "Active" },
      { value: "pending", label: "Pending" },
      { value: "fixed", label: "Fixed" },
      { value: "wontFix", label: "Will not fix" },
      { value: "closed", label: "Closed" },
    ],
    resolvedStates: ["fixed", "wontFix", "closed"],
  },
  github: {
    label: "GitHub",
    cli: "gh",
    threadStates: [
      { value: "active", label: "Unresolved" },
      { value: "resolved", label: "Resolved" },
    ],
    resolvedStates: ["resolved"],
  },
};

/**
 * The words one host uses, from the connections the server served. Every
 * surface that has to name a host goes through here, so the sidebar, the
 * thread dropdown and the confirmation cannot say three different things.
 */
export function useHost(provider: ProviderKind | "" | undefined): HostWords {
  const connections = useStore((state) => state.connections);
  const kind: ProviderKind = provider || "azure";
  return connections.find((connection) => connection.provider === kind) ?? FALLBACK[kind];
}

/**
 * Just the host's name, and only when one is actually known: a control that
 * spans pull requests on different hosts must not claim either of them.
 */
export function useHostName(provider: ProviderKind | "" | undefined): string | undefined {
  const connections = useStore((state) => state.connections);
  if (!provider) return undefined;
  return connections.find((connection) => connection.provider === provider)?.label ?? FALLBACK[provider].label;
}

/** The host of the repo the dashboard was started in, when it has one. */
export function useCurrentConnection(): Connection | null {
  const context = useStore((state) => state.context);
  const connections = useStore((state) => state.connections);
  return connections.find((connection) => connection.provider === context.provider) ?? null;
}
