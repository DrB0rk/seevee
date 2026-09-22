# Seevee CLI and workspace operation

## User workflow

Seevee is installed as a command named `seevee`.

A normal local project begins with:

~~~sh
mkdir my-cv
cd my-cv
seevee init
~~~

`seevee init` is non-interactive. It scaffolds/validates the directory, starts the local dashboard server detached, health-checks it, opens the browser, then exits.

The user launches their chosen external agent separately in the same directory. Do not assume a particular agent runtime.

## Workspace discovery

Before operating, identify the workspace root from `seevee.json` and load canonical resource IDs/revisions.

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
seevee open
~~~

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
