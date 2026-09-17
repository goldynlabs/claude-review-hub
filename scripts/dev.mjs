#!/usr/bin/env node
/**
 * Development launcher.
 *
 * `claude-review-hub` runs the built output, so every source change would need a
 * build and a restart. This runs the sources instead: the server under
 * `tsx watch`, the dashboard under Vite, both pointed at a real repo to
 * review. Ports are chosen at start-up and handed to Vite, so a claude-review-hub
 * already running on 4319 cannot silently steal the proxy target.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installSkill, isGitRepo } from "./install-skill.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
// Whatever repo was last developed against; plain `npm run dev` reuses it.
const lastFile = path.join(root, ".dev-project");

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
  npm run dev [-- <repo path>] [--api-port <n>] [--web-port <n>]

  Runs the tool from source, with hot reload, against a repo to review.
  The repo is remembered, so later runs can be just 'npm run dev'.

  Examples:
    npm run dev -- "C:\\Source code\\your-repo"
    npm run dev
`);
  process.exit(0);
}

function flag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** The repo path, given bare: anything that is not a flag or a flag's value. */
const positional = args.find((arg, index) => !arg.startsWith("-") && !args[index - 1]?.startsWith("-"));
const remembered = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, "utf8").trim() : "";
const chosen = flag("--project") ?? positional ?? remembered;
const target = chosen ? path.resolve(chosen) : "";

if (!chosen) {
  console.error(`
  Say which repo to review, once:

      npm run dev -- "C:\\Source code\\your-repo"

  It is remembered after that, so later runs are just 'npm run dev'.
`);
  process.exit(1);
}

if (!isGitRepo(target)) {
  console.error(`\n  ${target} is not a git repository.\n`);
  process.exit(1);
}

fs.writeFileSync(lastFile, target);

/**
 * Asked by connecting, not by binding: Windows lets a wildcard bind succeed
 * while another process holds the same port on a specific address, so a bind
 * probe calls ports free that Express or Vite then fails to take.
 */
function answers(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** The dev server must own the port Vite proxies to, so it is picked up front. */
async function free(from, { skip = [], attempts = 20 } = {}) {
  for (let candidate = from; candidate < from + attempts; candidate += 1) {
    // `skip` holds ports already handed to a child that has not bound yet;
    // without it both halves can be told to use the same one.
    if (skip.includes(candidate)) continue;
    // Both families: Express listens on IPv4 and IPv6, Vite resolves localhost
    // to ::1 first on Windows.
    if (!(await answers(candidate, "127.0.0.1")) && !(await answers(candidate, "::1"))) return candidate;
  }
  throw new Error(`No free port from ${from}.`);
}

const apiPort = Number(flag("--api-port")) || (await free(4319));
const webPort = Number(flag("--web-port")) || (await free(4318, { skip: [apiPort] }));

// Same as a real start: the repo gets the current skill before anything runs.
installSkill(target, { quiet: true });

console.log(`
  Claude Review Hub (dev, hot reload)
  project : ${target}
  api     : http://localhost:${apiPort}
  open    : http://localhost:${webPort}

  Editing server/ or web/ reloads by itself. Editing skill/ needs a restart.
  Ctrl+C stops both.
`);

const env = {
  ...process.env,
  REVIEW_TOOL_PROJECT: target,
  PORT: String(apiPort),
  // Read by web/vite.config.ts, so the proxy always finds the server above.
  API_PORT: String(apiPort),
  // The proxy target is fixed now, so the server must not drift off this port.
  REVIEW_TOOL_STRICT_PORT: "1",
};

// The local entry points are run by node directly. Going through npx and a
// shell would leave the real processes as grandchildren, and on Windows those
// survive a kill and keep holding the ports.
const bin = (...parts) => path.join(root, "node_modules", ...parts);
const children = [
  spawn(process.execPath, [bin("tsx", "dist", "cli.mjs"), "watch", "server/src/index.ts"], {
    cwd: root,
    env,
    stdio: "inherit",
  }),
  spawn(process.execPath, [bin("vite", "bin", "vite.js"), "--port", String(webPort), "--strictPort"], {
    cwd: path.join(root, "web"),
    env,
    stdio: "inherit",
  }),
];

let stopping = false;
const stopAll = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    // tsx runs the server in a child of its own, so the whole tree has to go;
    // a survivor would hold the port and quietly serve stale code later.
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      child.kill();
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
// One half dying is not a working dashboard, so the other goes with it.
for (const child of children) child.on("exit", stopAll);
