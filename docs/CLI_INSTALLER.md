# CLI, Installer and Local Workspace Runtime

Status: architecture contract
Date: 2026-09-23

## 1. Goal

Seevee is installed once and exposed as the command:

~~~sh
seevee
~~~

A new local CV workspace is created by running:

~~~sh
mkdir my-cv
cd my-cv
seevee init
~~~

`seevee init` is deliberately non-interactive. It must not hold the terminal open. It scaffolds or validates the current directory, starts the Seevee dashboard server as a detached background process, waits for a health check, opens the dashboard in the user's default browser, prints a concise result, and exits.

After that, the user can launch any coding/AI agent they want from the same directory. Agents operate on the local Seevee workspace files and the dashboard observes validated changes.

## 2. Distribution strategy

### Primary distribution: scoped npm package

The unscoped npm package name `seevee` is already occupied by an unrelated package. Do not depend on owning that package name.

Publish the CLI under a scoped package, for example:

~~~text
@drb0rk/seevee
~~~

or, if a dedicated organization is created later:

~~~text
@seevee/cli
~~~

The package still exposes the executable `seevee` through `package.json`:

~~~json
{
  "name": "@drb0rk/seevee",
  "type": "module",
  "bin": {
    "seevee": "./dist/cli.js"
  }
}
~~~

The executable starts with:

~~~js
#!/usr/bin/env node
~~~

This preserves the desired UX:

~~~sh
npm install -g @drb0rk/seevee
seevee init
~~~

Also support:

~~~sh
pnpm add -g @drb0rk/seevee
~~~

The exact publication scope can change without changing the executable name.

### Secondary distribution: bootstrap installers

Provide versioned installer scripts that install the scoped CLI package and verify the executable:

~~~sh
curl -fsSL https://<official-host>/install.sh | sh
~~~

Windows:

~~~powershell
irm https://<official-host>/install.ps1 | iex
~~~

The scripts must:

1. detect supported OS/architecture;
2. verify Node.js meets the supported runtime version;
3. install or clearly report the missing prerequisite;
4. install a pinned/current Seevee release from the official package;
5. verify `seevee --version`;
6. never modify unrelated shell configuration without explicit flags.

A future standalone-binary distribution can be added, but it should not block the MVP. Astro server/runtime and Playwright browser management make the Node package the lower-risk first distribution.

### Package-name note

Do not publish under the unrelated existing unscoped `seevee` npm package. The command name and package name are independent because npm's `bin` field controls the executable installed into PATH.

## 3. CLI package architecture

Add:

~~~text
packages/
  cli/
    src/
      cli.ts
      commands/
        init.ts
        start.ts
        stop.ts
        restart.ts
        status.ts
        open.ts
        validate.ts
        doctor.ts
        export.ts
      runtime/
        daemon.ts
        ports.ts
        browser.ts
        process-state.ts
        workspace-discovery.ts
      scaffold/
        create-workspace.ts
        agent-files.ts
    package.json
~~~

The CLI package should remain a thin orchestration layer. Core schema, renderer and server behavior belongs in shared packages.

## 4. `seevee init` contract

### Command

~~~sh
seevee init [path]
~~~

Default path is the current working directory.

### Required behavior

The command performs these steps in order:

1. resolve the target directory to an absolute path;
2. inspect for an existing Seevee workspace;
3. create missing workspace directories/files atomically;
4. never prompt for input;
5. never overwrite a conflicting existing file unless an explicit destructive flag is supplied;
6. validate the scaffold;
7. ensure the local runtime is not already running for this workspace;
8. choose an available loopback port;
9. start the dashboard server detached;
10. wait for `/api/health` to report the correct workspace ID and server version;
11. persist runtime state;
12. open the dashboard in the default browser unless `--no-open`;
13. print the workspace path, URL, process state and next commands;
14. exit 0.

The terminal is not the server lifecycle owner.

### Idempotency

Running `seevee init` again in an initialized directory should:

- validate/migrate the existing workspace if needed;
- create only missing managed files;
- leave user-created data untouched;
- reuse an already healthy server;
- recover from stale runtime metadata;
- open the dashboard;
- exit.

It must not create duplicate CV IDs, duplicate comments resources, duplicate templates or additional nested workspaces.

### Non-empty directories

A non-empty directory is allowed.

Seevee creates only its declared managed files/directories. If a would-be managed path already exists with incompatible content, fail with a machine-readable conflict and a human-readable explanation. Do not ask an interactive confirmation question.

Optional explicit recovery flags may later include:

~~~text
--repair
--force-managed-files
~~~

These must remain non-interactive and precisely scoped.

## 5. Workspace filesystem layout

Recommended initialized layout:

~~~text
my-cv/
├── AGENTS.md
├── seevee.json
├── cv.json
├── provenance.json
├── presentation.json
├── comments.json
├── sources/
│   ├── raw/
│   └── extracted/
├── templates/
│   └── local/
├── exports/
└── .seevee/
    ├── runtime.json
    ├── server.pid
    ├── locks/
    ├── logs/
    │   └── server.log
    ├── history/
    ├── diagnostics/
    └── agent/
        ├── README.md
        └── seevee-agent/
~~~

### Canonical versus runtime files

Canonical/user-owned:

- `seevee.json`
- `cv.json`
- `provenance.json`
- `presentation.json`
- `comments.json`
- source material
- local template source
- exports if the user chooses to version them

Runtime/ephemeral:

- PID
- selected local port
- locks
- server logs
- render caches
- build caches
- temporary browser/export state

Runtime data belongs under `.seevee/` and should be gitignored where appropriate.

Do not store process IDs, ports or transient server state inside canonical schema documents.

## 6. Agent-agnostic workspace

The workspace must work with arbitrary agents. Seevee does not require a specific agent runtime.

`seevee init` creates a generic `AGENTS.md` only if one does not exist. If one already exists, Seevee must not overwrite it; instead create `.seevee/agent/README.md` and report that the existing agent file was preserved.

The generated agent guide points agents to:

- canonical schema files;
- stable-ID/reference requirements;
- comments workflow;
- template restrictions;
- A4 render rules;
- deterministic validation commands;
- the bundled Seevee agent skill/reference material.

The dashboard and CLI must not launch or manage the user's external coding agent. The user opens Claude Code, Codex, OMP, Cursor, another CLI, or any future agent directly in the directory.

### File watching

The dashboard server watches canonical workspace files and approved template paths.

On external agent write:

1. wait for the file to become stable;
2. parse;
3. structural schema validate;
4. semantic validate;
5. accept and publish a revision event only if valid;
6. retain last-known-good state when invalid;
7. show the validation error in the dashboard.

Use atomic-write conventions in Seevee tooling. External agents are instructed to write to a temporary sibling file and rename where possible.

The dashboard must never render half-written JSON as canonical state.

## 7. Background server lifecycle

### Start

`seevee start [path]` starts the server in the background and exits.

Default bind address:

~~~text
127.0.0.1
~~~

Do not bind to `0.0.0.0` unless the user explicitly opts in.

### Detached process

On Node, spawn the installed server entry point with a detached process, non-inherited stdio redirected to the workspace log, and unreference it from the parent event loop.

Conceptual behavior:

~~~text
spawn(server, args, {
  detached: true,
  stdio: logFiles,
  windowsHide: true
})
child.unref()
~~~

The actual implementation must be integration-tested on Linux, macOS and Windows.

### Health gate

The parent CLI does not simply assume process creation means success.

Before `init` or `start` exits successfully:

- poll a short-lived local health endpoint;
- verify workspace ID;
- verify process/runtime version;
- verify expected bind address/port;
- fail and surface the log path if startup is unhealthy.

The CLI may wait briefly for startup, but it must never become the long-running process.

### Runtime state

`.seevee/runtime.json` stores only local runtime metadata:

~~~json
{
  "workspaceId": "ws_...",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 43127,
  "startedAt": "2026-09-23T01:00:00Z",
  "serverVersion": "0.1.0"
}
~~~

Treat PID files as hints, not proof. Verify process identity/health before stopping or reusing one.

## 8. Browser opening

After health succeeds, open:

~~~text
http://127.0.0.1:<port>/
~~~

Use a cross-platform browser-opening implementation.

Flags:

~~~text
--no-open
--port <number>
--host <address>
~~~

`--host` values other than loopback should display a security warning and may require an explicit `--allow-network` flag.

## 9. Core commands

### Required MVP commands

~~~text
seevee init [path]          scaffold + validate + start + open + exit
seevee start [path]         start background server + exit
seevee stop [path]          stop this workspace server
seevee restart [path]       restart background server
seevee status [path]        print machine/human-readable runtime status
seevee open [path]          open the active dashboard
seevee validate [path]      run schema + semantic validation
seevee doctor [path]        diagnose runtime/browser/schema/template problems
seevee export [path]        export PDF from canonical state
seevee --version
seevee --help
~~~

### Useful later commands

~~~text
seevee migrate
seevee template list
seevee template validate <id>
seevee template create <name>
seevee comments list
seevee schema print <resource>
seevee clean --cache
~~~

Do not make routine commands interactive. If input is required, accept flags/files/stdin explicitly or fail with actionable guidance.

## 10. Exit codes and machine use

Keep stable exit codes:

~~~text
0  success
1  general failure
2  invalid CLI usage
3  workspace conflict/not initialized
4  validation failure
5  server startup/lifecycle failure
6  export/render failure
7  migration required/failed
~~~

Add `--json` to status, validate, doctor and export-result commands so agents/scripts can consume them deterministically.

Example:

~~~sh
seevee status --json
seevee validate --json
~~~

## 11. Port selection and multiple workspaces

Each workspace can run independently.

Selection order:

1. explicit `--port`;
2. healthy persisted runtime for same workspace;
3. configured preferred port;
4. first available loopback port from a defined range.

Never stop another Seevee workspace merely because its port is occupied.

The dashboard URL is workspace-specific through the bound local process, not a global singleton daemon in the MVP.

A global daemon may be considered later only if multiple-workspace management becomes necessary.

## 12. PDF/Chromium installation

Do not make every CLI install download a large browser payload unless release testing proves that is the best UX.

Preferred MVP:

- install the lightweight CLI/runtime normally;
- detect a compatible Playwright Chromium installation;
- lazily provision the supported browser into the user cache when first required by export/render diagnostics;
- expose the state in `seevee doctor`;
- allow an explicit preinstall command later.

The dashboard preview should be usable even before the export browser is provisioned.

## 13. Updates

`seevee --version` reports:

- CLI version;
- studio/server version;
- schema package version.

The dashboard surfaces version mismatch between CLI/runtime/workspace schema.

Do not self-modify the installed package silently. Package-manager updates remain explicit:

~~~sh
npm install -g @drb0rk/seevee@latest
~~~

A future `seevee update` may wrap the package manager, but only with clear provenance and explicit action.

## 14. Security defaults

Local server:

- loopback only;
- random per-workspace session secret where browser/API mutation protection is needed;
- no CORS wildcard;
- strict origin checks;
- no remote source fetch without SSRF controls;
- no template-generated server routes;
- no arbitrary filesystem access outside the workspace and approved runtime cache.

When network binding is enabled explicitly, require authentication before considering the feature production-ready.

## 15. Test matrix

CLI tests:

- fresh empty directory;
- non-empty safe directory;
- incompatible managed-file conflict;
- repeat `init`;
- stale PID/runtime metadata;
- existing healthy server;
- port occupied by unrelated process;
- two simultaneous workspaces;
- path containing spaces/Unicode;
- read-only directory;
- invalid JSON workspace file;
- required migration;
- `--no-open`;
- `--json`;
- stop/restart/status lifecycle.

Platform integration:

- Linux;
- macOS;
- Windows PowerShell/cmd path behavior.

Process lifecycle tests assert that:

- `seevee init` exits after health success;
- closing the invoking terminal does not kill the server;
- server logs are still available;
- `seevee stop` stops only the correct workspace;
- stale PID reuse cannot kill an unrelated process.

## 16. Implementation sequence

1. Create `packages/cli`.
2. Expose `seevee` using npm `bin`.
3. Implement workspace discovery and schema-version checks.
4. Implement deterministic scaffold generation.
5. Generate generic agent instructions/skill copy.
6. Implement detached server launcher and health check.
7. Implement runtime state/locks/logging.
8. Implement browser opening.
9. Implement start/stop/restart/status/open.
10. Implement validate/doctor.
11. Integrate export.
12. Add installer scripts.
13. Add release workflow and signed/checksummed installer artifacts where applicable.
14. Run platform lifecycle tests.

## 17. MVP acceptance criteria

The CLI/distribution portion is complete only when:

- a clean machine with supported Node can install the official scoped package;
- `seevee` is available on PATH;
- `seevee init` requires no prompts;
- init can safely run in a non-empty directory;
- default A4 canonical workspace files are created;
- generic agent instructions are created without overwriting an existing user agent file;
- a local server starts in the background;
- health is verified before success is reported;
- the default browser opens to the correct workspace;
- the command exits and returns terminal control;
- an arbitrary external agent can edit the workspace files;
- valid external edits live-update the dashboard;
- invalid edits are rejected from canonical live state and surfaced clearly;
- `status`, `stop`, `restart`, `validate` and `doctor` work;
- multiple directories can run as separate workspaces;
- Linux, macOS and Windows lifecycle tests pass.

## 18. Primary references

Implementation should be verified against current primary documentation:

- npm package `bin` behavior: https://docs.npmjs.com/files/package.json/#bin
- Node child process detached/unref behavior: https://nodejs.org/api/child_process.html#optionsdetached
