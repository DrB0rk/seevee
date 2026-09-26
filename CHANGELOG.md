# Changelog

All notable user-visible changes to Seevee are documented here.

This project uses Semantic Versioning. See `.dev/VERSIONING.md` for the project policy.

## [Unreleased]

## [0.1.0] - 2026-09-26

### Changed
- Promote the verified alpha.14 build to the first stable 0.1.0 release.

## [0.1.0-alpha.14] - 2026-09-26

### Added

- A light theme with a top-bar toggle. Both themes are defined by the same semantic tokens, so switching is one attribute on the root; the choice persists to local storage, follows `prefers-color-scheme` until the user picks for themselves, and is applied before first paint so light-mode users never see a dark flash. Agent chat surfaces (code blocks, failure blocks, question cards, session menu) read tokens so they invert with the shell.
- `seevee template list | draft | validate | compile | activate` implements the template authoring lifecycle end to end: a draft is seeded as a new version directory from the active one, compiled against the template's own fixtures with the real policy/manifest/Astro/layout stages, and activated by repointing the workspace. Activation re-validates first, so a broken template can never become the version the dashboard renders.
- Workspace agent instructions now document where templates, stylesheets, and CV resources live, give the exact four-command recipe for restyling a CV, require `seevee validate` before a run is reported complete, and document how to read and change page size, margins, and pagination in `presentations/<id>.json`. They also state plainly that no automated page-fit check exists yet, so an agent cannot claim a layout fits without saying it reasoned about it.
- User prompts are persisted with the agent session instead of in browser storage, so your half of a conversation survives reloads, resumes, and other tabs. The session picker labels sessions by the first thing you asked.

### Changed

- Every remaining surface is brought onto the same system: the context menu becomes a grouped menu with right-aligned glyphs and danger-toned destructive rows; comment cards get index chips, labelled status pills, recede when resolved, and reveal actions on hover; the settings modal and its sidebar, the top bar brand and version chip, asset rows, section eyebrows, and the agent chat composer, context chip, stop control, and quick bar all adopt the same surfaces, radii, pills and active states.
- Canvas tools move from the canvas bar into a floating vertical tool rail over the pasteboard, with the active tool as a filled accent square, matching the canvas-tool pattern in the reference tools.
- Section navigation becomes a layer list: leading glyph, title, trailing entry count, and a checkmark that appears only on the selected row, which is tinted with an inset accent bar.
- Duplicate stacked CSS definitions for the same components are collapsed to a single authoritative rule, so later blocks can no longer silently override a selected or themed state.
- The dashboard gains a consistent control system: segmented control for document mode, icon buttons with a legible pressed state, boolean settings as switches, a single text-field shape, and disclosure headers with a rotating leading-edge chevron. Editor field labels, heights, borders, radii and focus treatment are uniform.
- Text-field rules are scoped with `:not([type="checkbox"])` so switches are never repainted as inputs, and a late block of hardcoded dark field styles is tokenized. The editor panel previously kept dark surfaces in light mode; it now inverts with the rest of the shell.
- The dashboard theme is rebuilt on a semantic token layer with a real elevation ladder, replacing a palette whose five surface values sat within a few percent of each other and read as one blue-grey field. Surfaces, borders, text, status, radii, shadows and focus rings are all tokens; literal colours are mapped to them across `dashboard.css` and `agent-chat.css`, and the agent chat's purple user bubble now sits in the accent family instead of fighting the blue theme. Visual Design §4 documents the shipped tokens.
- Border radii are normalised to a single six-step scale. The chat composer and quick bar remain pills by intent.
- When an agent asks the user something (Codex `requestUserInput`, MCP elicitation, ACP `elicitation/create`), the chat renders it as a multiple-choice card with option descriptions and an always-available free-text answer, instead of a raw JSON textarea. The selected answer is sent back as a structured payload.
- Every agent session now receives a workspace context preamble naming the active CV, presentation, and registered templates, and stating explicitly whether the conversation is new or resumed. A fresh agent can now tell "this CV" from the one it edited last hour, and knows a new session carries no history beyond the files on disk.
- The agent chat status line reports the kind of work in progress instead of the raw command that produced it; the exact arguments stay in the collapsed activity row.
- The agent chat header is two rows: agent, model, and actions on the first, the session picker on the second. The native `<select>` is replaced by a real listbox that groups Active and History sessions, shows the agent, title and time as separate elements, marks the current session, and supports arrow-key navigation, Enter, Escape and click-outside.
- Session titles are derived from the first prompt when the provider supplies a generic one, capped at the first sentence so a pasted paragraph cannot become a session name.
- The composer context chip is on by default and shows the real active CV id from the workspace rather than a scraped display name.
- Agent chat is a single strictly ordered stream: user prompts and agent activity are interleaved by time, and the live status card sits under the most recent message instead of pinned above the transcript.
- Completed agent messages no longer move after later tool activity; the transcript keeps provider emission order so it stops reshuffling mid-run.
- Failed tool calls collapse into a grouped activity row that reports how many calls failed and reveals each failing command and its error on demand. Full stack traces no longer dominate the transcript.
- The live status card no longer claims a clean run while failed calls are printed above it; it reports the failure count alongside the validation result.
- Reasoning rows with no text are omitted instead of rendering as permanently empty collapsed disclosures (Codex streams an empty content array on every turn).
- The agent chat live status is plain text in the transcript rather than a bordered banner, and scrolls away with the conversation instead of pinning to the panel.
- The agent chat header leads with the active agent and its model as a chip, drops the redundant panel title, and hides the session-picker label that was rendering as visible text (the `sr-only` utility was only defined under the composer).
- Command and tool rows in agent chat collapse to a single quiet line with no status text, and error cards collapse the same way with their message in the summary.
- Agent chat UI: every message carries an identity row (author, time, copy), your messages render as right-aligned bubbles, and agent replies get a left rule and a readable measure.

### Fixed

- The floating canvas tool rail scrolled away with the document because it was absolutely positioned inside the scrolling pasteboard. It is now anchored to the work area, which does not scroll, and holds position while the page scrolls beneath it.
- The three-column dashboard shell needed 982px but only stacked below 880px, so viewports between 881 and 981 overflowed and the outer clip hid the right panel. The stacking breakpoint is now 982px, the exact minimum, matching Visual Design §18.
- Dashboard CSS declared `.studio` twice, byte for identical; the duplicate is removed.
- Agent chat metadata colours (`#6b7681`, `#606b75`, `#64717e`) measured 2.6-4.1:1 on the panel surfaces they sit on, below WCAG 2.2 AA for normal text. They now use `#8b96a1`, which clears 4.5:1 on all four surfaces.
- Agent chat readable metadata is raised from 8-9px to 9.5-10px; uppercase micro-labels keep their smaller size as labels rather than content.
- Dashboard panel resizers get a 13px pointer hit area while keeping the 1px visual divider.
- The chat status line no longer reports a turn as failed the moment one command fails. The run keeps showing as working, with the failure count in the detail, and only becomes `failed` when the turn actually ends in failure.
- Reasoning rows are no longer dropped when a provider streams no reasoning text. They render as a live `Thinking` heartbeat, because an empty row was the only signal a long run was still alive.
- `seevee validate` ran its cross-resource semantic pass against hardcoded `cvs/main.json` and `provenance/main.json` paths that no workspace contains, so it silently validated nothing and reported success on broken workspaces. It now loads the active CV, presentation, provenance, and comments from their `seevee.json` registrations — the same set the dashboard checks — and exits 4 on a dangling provenance target.
- The agent chat status line no longer repeats the phase label in its detail ("Command failed · a shell command failed"); it reports the failure count and the next action instead.
- The studio test workspace fixture referenced a `templates/tpl_minimal` directory that was never tracked in git, so a clean checkout produced an unloadable workspace. The template fixture is now committed alongside the rest of the workspace.

## [0.1.0-alpha.13] - 2026-09-25

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
- Applied the same pnpm build policy to the synthetic runtime resolver used for release bundles.
- Fixed Windows bundle verification to extract archives using an absolute destination path.
- Changed default release discovery to query the public release list directly, eliminating the expected 404 from prerelease-only projects.

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
