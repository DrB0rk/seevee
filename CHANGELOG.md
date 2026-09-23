# Changelog

All notable user-visible changes to Seevee are documented here.

This project uses Semantic Versioning. See `.dev/VERSIONING.md` for the project policy.

## [Unreleased]

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
