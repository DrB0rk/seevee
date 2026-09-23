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

### Canonical installation: GitHub-hosted installer

The public installation path is a shell installer fetched directly from this GitHub repository.

Target UX:

~~~sh
curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
~~~

Then:

~~~sh
mkdir my-cv
cd my-cv
seevee init
~~~

Do **not** require npm, pnpm, Homebrew, or another package manager for the normal user installation flow.

The repository may use npm/pnpm internally during development and release builds. That implementation detail must not leak into installation instructions.

### Release model

GitHub Releases are the distribution source of truth.

Each release should publish versioned runtime bundles, for example:

~~~text
seevee-v0.1.0-linux-x64.tar.gz
seevee-v0.1.0-linux-arm64.tar.gz
seevee-v0.1.0-darwin-x64.tar.gz
seevee-v0.1.0-darwin-arm64.tar.gz
seevee-v0.1.0-windows-x64.zip
SHA256SUMS
~~~

A release bundle contains everything the installed Seevee launcher needs except explicitly documented OS prerequisites. Prefer a self-contained application bundle over resolving packages at install time.

If the first implementation still requires a system Node runtime, the installer may verify a supported Node version and fail with a precise message. It must not invoke npm to install Seevee.

### Installer behavior

`install.sh` must:

1. run non-interactively;
2. detect OS and CPU architecture;
3. resolve the requested version or latest stable GitHub release;
4. download the matching release archive from GitHub Releases;
5. download the published checksum manifest;
6. verify SHA-256 before extraction;
7. install versioned files under a user-owned application directory, e.g. `~/.local/share/seevee/<version>/`;
8. create/update a stable launcher at `~/.local/bin/seevee`;
9. preserve previous versions until activation succeeds;
10. verify `seevee --version`;
11. print a concise PATH hint only when `~/.local/bin` is not currently reachable;
12. exit without modifying unrelated shell configuration.

Support:

~~~sh
SEEVE_VERSION=v0.2.0 curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
~~~

or an equivalent documented version argument mechanism that remains safe through a pipe.

### Update behavior

A future `seevee update` should use the same GitHub Release + checksum path as `install.sh`.

It should:

- fetch release metadata;
- download into a new version directory;
- verify checksums;
- run a version/health self-check;
- atomically switch the stable launcher;
- retain the previous version for rollback.

Do not silently update in the background.

### Windows

Provide a PowerShell equivalent:

~~~powershell
irm https://raw.githubusercontent.com/DrB0rk/seevee/main/install.ps1 | iex
~~~

The Unix `curl | sh` path is the primary documented installer; PowerShell should mirror the same GitHub Release/checksum model.

### Trust and supply-chain requirements

The installer must never execute a downloaded payload before integrity verification.

Release hardening should include:

- SHA-256 manifest;
- GitHub release provenance;
- reproducible or at least deterministic build workflow where practical;
- release workflow pinned to reviewed actions/versions;
- optional artifact signing in a later phase;
- no install-time dependency resolution from arbitrary registries.

## 3. CLI/runtime package architecture

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

It must not create duplicate CV IDs, duplicate library entries, duplicate templates or additional nested workspaces.

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
├── cvs/
│   └── main.json
├── provenance/
│   └── main.json
├── comments/
│   └── main.json
├── presentations/
│   └── main.json
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
- every `cvs/*.json` CV document
- `provenance/*.json`
- `comments/*.json`
- `presentations/*.json`
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

1. Create `packages/cli` and the production runtime bundle.
2. Build platform release archives suitable for direct GitHub Release installation.
3. Add root `install.sh` and `install.ps1` that install from GitHub Releases with checksum verification.
4. Implement workspace discovery and schema-version checks.
5. Implement deterministic scaffold generation.
6. Generate generic agent instructions/skill copy.
7. Implement detached server launcher and health check.
8. Implement runtime state/locks/logging.
9. Implement browser opening.
10. Implement start/stop/restart/status/open.
11. Implement validate/doctor.
12. Integrate export.
13. Add release workflow, checksums and install integration tests.
14. Add optional artifact signing/rollback hardening.
15. Run platform lifecycle tests.

## 17. MVP acceptance criteria

The CLI/distribution portion is complete only when:

- a clean supported machine can install Seevee using the GitHub-hosted `curl | sh` installer without npm/pnpm;
- `seevee` is available on PATH;
- `seevee init` requires no prompts;
- init can safely run in a non-empty directory;
- an initial `cvs/main.json` CV plus associated provenance/comments/presentation resources are created, with A4 as the default presentation profile;
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

- GitHub Releases REST/API and release assets: https://docs.github.com/en/rest/releases/releases
- GitHub release asset downloads: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- Node child process detached/unref behavior: https://nodejs.org/api/child_process.html#optionsdetached
