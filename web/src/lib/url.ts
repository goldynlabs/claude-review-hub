/**
 * Where you are, in the address bar: which session, which pull request, which
 * tab. A refresh, a restart of the tool, or a link pasted to someone else all
 * land back on the same place, instead of on whatever session happens to be
 * newest.
 */
export type UrlKey = "session" | "pr" | "tab";

export function readUrl(key: UrlKey): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

/** Replaces rather than pushes: moving between PRs is not browser history. */
export function writeUrl(values: Partial<Record<UrlKey, string | null>>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}
