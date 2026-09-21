# Ready-made profiles

Starting points, not defaults. Nothing here is installed on its own: the first
start in a project asks once, in the terminal, whether to import them, and
otherwise they sit here until you take one.

They are grouped by the kind of change a pull request is, because that is what
decides what a reviewer should be asking, far more than the stack it is written
in.

| File | Pick it when the PR is | What it looks for |
|---|---|---|
| [`bug-fix.json`](bug-fix.json) | a fix | Root cause vs symptom, whether it actually fixes it, the same bug elsewhere, regression risk, edge cases, a test that proves it |
| [`new-feature.json`](new-feature.json) | a feature | The stated requirement, defects and side effects, tenant and permission isolation, data and contract, fit with the codebase, failure states, flags and rollout, UI and UX, cost |
| [`refactor.json`](refactor.json) | meant to change nothing | Behaviour preserved, call sites left behind, the safety net, boundaries others depend on, functional edits smuggled in, whether it is actually simpler |
| [`database-migration.json`](database-migration.json) | a schema change | Deploy order, locking, reversibility, integrity, query plans |
| [`dependency-update.json`](dependency-update.json) | a bump or a config change | What the new version broke, the rest of the lockfile, call sites left on the old API, build and CI config, blast radius and rollback |
| [`security.json`](security.json) | reachable from outside | Authorisation, injection, exposed secrets, session and crypto, widened config |

The first three read the pull request description and the linked ticket as the
statement of what the change is supposed to do, and report against it. They are
the ones that pay off on any project, whatever it is written in.

Two more go the other way, by layer rather than by kind of change. They are
deliberately expensive: they ask the reviewer to read the code around the diff
and follow the call sites, and they have seven dimensions each. Reach for one
when a pull request deserves a long look, not for every PR.

| File | What it digs into |
|---|---|
| [`backend-deep.json`](backend-deep.json) | Transaction boundaries and lock order, idempotency under retries and duplicate delivery, contract for clients on the old release, timeouts and retry amplification, authorisation and payload binding at the edge, what on-call sees, leaked connections and blocking work |
| [`frontend-deep.json`](frontend-deep.json) | State that drifts from its source and cache keys that miss, effects and dependency arrays, request races and double submits, forms and locale-sensitive values, focus and keyboard and screen readers, render cascades and bundle cost, error boundaries, XSS and hydration |

Test quality and performance are not profiles of their own here. Nobody reviews
a pull request through only that lens, and as a whole-PR profile both produce
mostly speculation. They live where they bite instead: "a test that proves it"
in `bug-fix`, "the safety net" in `refactor`, a test line in the requirement
check of `new-feature`, and "cost on the hot path" in `new-feature`.

## Importing one

The first-run question imports all of them at once. It is asked once per
project: the answer, yes or no, is `.review-tool/config/profiles.json`.

To import without being asked, in a project that already answered or that has
no terminal to answer in:

```bash
npx claude-review-hub <repo> --profiles
```

It rewrites the shipped profiles by id and leaves your own untouched, so it is
also how you pick up the ones added by a newer version. `--no-profiles` is the
opposite: never ask, never import.

One at a time, in the dashboard: **Settings > Profiles > New**, then **Import**. Either pick
the downloaded file or paste its contents into the box. It fills the form and
saves nothing until you do, so edit it first: the wording is meant to be
argued with.

The id is minted locally on import, so the same file can be imported twice, and
a profile you edit afterwards is yours, not a copy that tracks this repo.

## Writing your own

Export any profile you already have from **Settings > Profiles > Export** and
you get this same shape. The fields:

| Field | Meaning |
|---|---|
| `name` | What the picker shows |
| `dimensions[]` | One concern per entry: a `label` and the `prompt` that says what to look for and what to cite |
| `context` | Free text handed to every dimension: a spec, a house rule, what not to report |
| `include` / `exclude` | Globs deciding which changed files are reviewed |
| `severityFloor` | `critical`, `warning` or `suggestion`: the lowest severity worth reporting |
| `confidenceFloor` | 0 to 1. Findings below it are stored but hidden by default |

A dimension earns its place by being concrete. "Look for bugs" gets you
opinions; naming the defect and the evidence the reviewer must point at gets
you findings you can act on.

A profile that is good for your stack is worth a pull request here.
