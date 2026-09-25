# Changelog

All notable user-visible changes to Seevee are documented here.

This project uses Semantic Versioning. See `.dev/VERSIONING.md` for the project policy.

## [Unreleased]

## [0.1.0-alpha.10] - 2026-09-25

### Added

- Central local agent control with isolated Claude Code Agent SDK, Codex App Server, and OMP ACP adapter modules.
- Resizable right-sidebar agent chat with streamed messages, provider-visible reasoning, plans, tool lifecycle, usage, workspace changes, validation, and inline approvals.
- Settings-driven agent detection, provider selection, session start/resume, provider-native model/permission controls, and saved-session controls.
- Same-origin agent APIs, resumable SSE agent events, bounded/redacted provider payloads, and atomic runtime session indexing.
- Hardened Unix and Windows installers with HTTPS-only transport, archive-path validation, atomic rollback, install locking, stale-version cleanup, and CI contract tests.
- Lockfile-pinned production runtime bundles that exclude optional native platform binaries and compile the agent runtime for release use.

### Changed

- Moved the unified agent experience to the right sidebar while keeping the document editor and comments on the left.
- Agent chat width defaults to 460 px and persists independently from the editor width.
- Refined the chat into a rounded composer with active-document context, native model/permission dropdowns, send control, and document/source/settings shortcuts.
- Release CI now builds the workspace once and reuses the compiled runtime across platform bundles; artifact verification remains comprehensive while limiting expensive daemon smoke tests to Linux.

### Fixed

- Fixed missing agent-runtime and ESM dependency links in release bundles.
- Fixed Windows installer rollback, archive validation, lock handling, PATH detection, and upgrade cleanup edge cases.
- Reduced Linux release bundles from roughly 150 MB to roughly 30 MB by excluding optional native binaries and non-runtime build artifacts.
- Aligned CI and release installs with pnpm 11.18.0 so the committed lockfile can be consumed with `--frozen-lockfile`.
- Configured pnpm 11 `allowBuilds` for the required native tools and moved dependency installation ahead of package scripts in release CI.

## [0.1.0-alpha.4] - 2026-09-23

### Fixed

- Stop two previously orphaned Seevee test daemons.
- Serialize workspace start and stop operations with a stale-owner-aware lock so parallel starts reuse one server instead of launching duplicate processes.
- Persist the server PID before the health wait so a later CLI invocation can recover a server after an interrupted start.

## [0.1.0-alpha.3] - 2026-09-23

### Fixed

- Accept same-origin editor saves when Astro's internal request URL differs from the browser hostname, while continuing to reject foreign origins.
- Enable PDF export from the editor through the browser's print dialog, with print styling for the CV page.

## [0.1.0-alpha.2] - 2026-09-23

### Added

- Editable local CV dashboard with a live document preview, structure navigation, and autosaving profile, experience, and skills fields.
- Revision-aware CV saves with schema validation and conflict detection.
- Migration of legacy workspaces with a timestamped backup of the original files.

### Fixed

- Fresh workspaces now use the canonical document envelopes expected by the dashboard.
- Release bundles include the Astro Studio server and its browser assets, and the daemon starts that server on the workspace port.

## [0.1.0-alpha.1] - 2026-09-23

### Fixed

- Launch the compiled dashboard daemon from release bundles, and save its startup output to the workspace log.

## [0.1.0-alpha.0] - 2026-09-23

### Added

- Runtime packages for schema validation, migrations, CLI workspace lifecycle, agent tools, source ingestion, template compilation, page layout, and PDF export orchestration.
- Astro Studio dashboard shell with workspace APIs and file watching.
- Classic and two-column template sources, plus cross-platform release bundle and checksum scripts.
- Unix and Windows installers for GitHub Release bundles.
- Package tests, typechecking, schema generation/drift checks, and CI workflows.

### Changed

- Bundle manifests resolve compiled ESM entry points and package version from the canonical root `VERSION`.
- Windows bundle uses a `.cmd` launcher that invokes Node instead of labeling JavaScript as an `.exe`.
- README and implementation status now identify the remaining placeholder paths.

### Fixed

- JSON Pointer schema now supports nested paths such as `/role/title`.
- Workspace resources explicitly index source documents.

### Incomplete

- Studio preview rendering, PDF export, agent execution, and image recognition remain placeholders. See `.dev/IMPLEMENTATION_STATUS.md`.
