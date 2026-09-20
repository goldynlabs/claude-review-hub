import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const profilesRoot = path.join(here, "..", "profiles");

/**
 * The ready-made profiles that ship with the package, in the shape the server
 * stores. They are not installed: this module only ever writes them after the
 * question below has been answered.
 */
export function suggestedProfiles() {
  if (!fs.existsSync(profilesRoot)) return [];
  const files = fs.readdirSync(profilesRoot).filter((name) => name.endsWith(".json")).sort();
  const profiles = [];
  for (const file of files) {
    try {
      profiles.push(normalise(JSON.parse(fs.readFileSync(path.join(profilesRoot, file), "utf8")), file));
    } catch {
      // A malformed suggestion is the tool's own problem, never the user's:
      // leave it out rather than failing a start-up over it.
    }
  }
  return profiles.filter(Boolean);
}

/** The exported shape has no id, because an id belongs to the machine it lands on. */
function normalise(input, file) {
  if (!input?.name || !Array.isArray(input.dimensions) || !input.dimensions.length) return null;
  return {
    id: `suggested-${slug(path.basename(file, ".json"))}`,
    name: String(input.name),
    dimensions: input.dimensions.map((dimension, index) => ({
      id: slug(dimension.label) || `dim-${index + 1}`,
      label: String(dimension.label),
      enabled: true,
      prompt: String(dimension.prompt),
    })),
    context: typeof input.context === "string" ? input.context : "",
    include: Array.isArray(input.include) ? input.include.filter((item) => typeof item === "string") : [],
    exclude: Array.isArray(input.exclude) ? input.exclude.filter((item) => typeof item === "string") : [],
    severityFloor: ["critical", "warning", "suggestion"].includes(input.severityFloor)
      ? input.severityFloor
      : "suggestion",
    confidenceFloor: typeof input.confidenceFloor === "number" ? input.confidenceFloor : 0,
  };
}

function slug(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Asked once per project, on the first start, and never again: the answer is
 * the profile store itself. Declining writes an empty one, which is exactly
 * what a project with no custom profiles has, so nothing is added to say no.
 * Delete .review-tool/config/profiles.json to be asked again.
 */
export async function offerProfiles(target) {
  const store = path.join(target, ".review-tool", "config", "profiles.json");
  if (fs.existsSync(store)) return;
  const profiles = suggestedProfiles();
  if (!profiles.length) return;

  // Nothing to answer with in CI, a pipe or an editor task: stay silent and
  // leave the question for a real terminal.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  console.log(`\n  ${profiles.length} ready-made review profiles ship with this tool:`);
  for (const profile of profiles) console.log(`    - ${profile.name}`);
  console.log("  They are starting points, editable in Settings > Profiles.");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = (await rl.question("\n  Import them? [y/N] ")).trim().toLowerCase();
  } finally {
    rl.close();
  }

  const wanted = answer === "y" || answer === "yes";
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify(wanted ? profiles : [], null, 2), "utf8");
  console.log(
    wanted
      ? `  profiles  ${profiles.length} imported -> .review-tool/config/profiles.json`
      : "  profiles  skipped. Import them any time from Settings > Profiles > New > Import.",
  );
}
