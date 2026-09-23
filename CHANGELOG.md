# Changelog

All notable user-visible changes to Seevee are documented here.

This project uses Semantic Versioning. See `.dev/VERSIONING.md` for the project policy.

## [Unreleased]

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
