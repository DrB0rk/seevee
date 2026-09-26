# Seevee CLI and workspace operation

## User workflow

Seevee is installed as a command named `seevee` using the repository's GitHub-hosted `install.sh` and GitHub Release bundles. Do not instruct users to install Seevee through npm.

A normal local project begins with:

~~~sh
mkdir my-cv
cd my-cv
seevee init
~~~

`seevee init` is non-interactive. It scaffolds/validates the directory, starts the local dashboard server detached, health-checks it, opens the browser, then exits.

The user launches their chosen external agent separately in the same directory. Do not assume a particular agent runtime.
`seevee init` also installs this workspace-agent guide and the references into `.seevee/agent/seevee-workspace-agent/`, then writes a root `AGENTS.md` when one is not already present. Existing user guidance is preserved.

## Workspace discovery

Before operating, identify the workspace root from `seevee.json`, resolve the active CV under `cvs/`, resolve its presentation/provenance/comments resources, and load canonical IDs/revisions.

Do not treat `.seevee/runtime.json`, PID files, logs, caches or temporary build files as canonical CV state.

## External agent writes

When editing workspace files directly:

- preserve schema envelopes, IDs and revisions according to the project mutation rules;
- prefer Seevee typed tools/CLI if available;
- write atomically where possible;
- run `seevee validate --json` after changes;
- never edit runtime PID/port files;
- do not start a second server blindly.

Useful commands:

~~~sh
seevee status --json
seevee validate --json
seevee doctor --json
seevee comments list --json
seevee open
~~~

Start or reopen the local dashboard with `seevee start`, get its URL with `seevee status`, open it with `seevee open`, and stop it cleanly with `seevee stop`. Do not kill the process directly.

## Dashboard/server ownership

The local server is background infrastructure. Do not keep a terminal attached to it and do not kill processes by a stale PID without Seevee's lifecycle checks.

Use:

~~~sh
seevee start
seevee stop
seevee restart
~~~

The server binds to loopback by default. Do not expose it to a network as part of an agent task unless the user explicitly requests that and the product's network/authentication policy is satisfied.

## Agent instructions

Read the workspace's `AGENTS.md` when present and the bundled Seevee references before editing canonical resources or template source.

The dashboard is fixed product UI. External agents may design CV templates but should not mutate the dashboard shell merely to alter a CV's visual design.

## Dashboard comments

Start with `seevee comments list --json` before editing. It finds the comments resource registered to the active CV, follows thread order, returns the latest message and includes semantic selectors, page placement and agent work state. By default it lists open and in-progress threads; use `seevee comments list --all` to include closed history. The selector order puts the strongest semantic anchor (`FieldSelector`, `NodeSelector`, or `SectionSelector`) before its `PageRegionSelector` fallback. The placement context includes a readable element label, visible-text snapshot, and normalized page coordinates. Resolve stable IDs against the current CV first; treat saved text and coordinates as clues if revisions have changed. Dashboard comments default to category `general` and priority `normal`; infer the work from the message and ask if it is unclear.

For machine workflows, `seevee status --json`, `seevee validate --json`, `seevee doctor --json`, and `seevee comments list --json` return structured data. To save a PDF, open the dashboard and use the browser's Print to PDF flow; CLI PDF export is not available yet. Use `seevee stop` when the task is complete and the dashboard was started for it.
