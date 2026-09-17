/**
 * Start-up finishes after the port is open, not before it. Detecting the host
 * and installing the skills takes a moment, and a dashboard that refuses
 * connections meanwhile looks broken: in dev the page is already polling, and
 * every request comes back as ECONNREFUSED rather than as "one moment".
 *
 * The two routes whose answer depends on that work await this; everything else
 * is served the whole time.
 */
let done: () => void;
export const ready = new Promise<void>((resolve) => {
  done = resolve;
});

export function markReady(): void {
  done();
}
