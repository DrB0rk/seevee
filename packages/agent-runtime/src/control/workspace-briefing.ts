/**
 * The operating briefing every workspace session receives.
 *
 * `formatWorkspaceContext()` states *which* document is active; this module
 * states *how to work here*. It is deliberately separate from the per-prompt
 * private snapshot (`apps/studio/src/lib/agent-prompt-context.ts`), which
 * carries state only — the rules live here, once, and are injected with the
 * session instructions so a fresh agent can act correctly on its first turn
 * instead of improvising or rediscovering the layout.
 *
 * Every command and path named below is part of the shipped CLI
 * (`packages/cli/src/cli.ts` `HELP_TEXT` + `packages/cli/src/commands/*`) or
 * the real scaffold layout (`packages/cli/src/scaffold/create-workspace.ts`).
 */

/** Workspace-root-relative path to the generated, user-editable workspace guide. */
export const WORKSPACE_GUIDE_PATH = 'AGENTS.md';

/** Workspace-root-relative directory holding the installed agent skill. */
export const WORKSPACE_AGENT_SKILL_DIR = '.seevee/agent/seevee-workspace-agent';

/** The skill entry point an agent should open first. */
export const WORKSPACE_AGENT_SKILL_ENTRY = `${WORKSPACE_AGENT_SKILL_DIR}/SKILL.md`;

/**
 * The briefing body. Kept as one exported string so the session preamble and
 * its tests read the same bytes; there is no second copy to drift.
 */
export const WORKSPACE_OPERATING_BRIEFING = `## How to work in this workspace

This directory is a Seevee CV workspace. Its canonical JSON documents — not rendered HTML or PDF output — are the source of truth.

**Read before your first edit, in this order.**

1. \`${WORKSPACE_GUIDE_PATH}\` in the workspace root — the generated workspace guide: entry points, editing rules, page/render rules, comments workflow, CLI examples. It is user-editable and \`seevee init\` never overwrites it. If an edited \`${WORKSPACE_GUIDE_PATH}\` conflicts with this briefing or the skill, follow this briefing and the skill, and mention the conflict.
2. \`${WORKSPACE_AGENT_SKILL_ENTRY}\` — the full Seevee workspace-agent contract, with \`references/\` beside it (data contract, comments, templates and rendering, workflows, CLI and workspace, CV guidance). Open the reference that matches the task; you do not need all of them.

**Layout.** \`seevee.json\` — workspace registry: active CV and presentation, registered resource paths and revisions, policy. \`cvs/<id>.json\` — CV content. \`presentations/<id>.json\` — page size, margins, tokens, pagination. \`templates/<template-id>/<version-id>/\` — template source; only the version named by \`currentVersionId\` renders. \`provenance/<cv-id>.json\`, \`comments/<cv-id>.json\`, \`sources/\` (uploads are catalogued in \`sources/uploads/index.json\`), \`exports/\` — PDF output.

**CLI first.** Run these instead of re-deriving the same facts by hand:

- \`seevee status --json\` — runtime state and dashboard URL. \`seevee doctor --json\` — diagnose runtime, browser, schema, and template problems.
- \`seevee validate --json\` — schema plus cross-resource semantics; exit code 4 on failure. Run it after every committed change and fix what it reports.
- \`seevee comments list --json\` — actionable comments for the active CV; \`--all\` includes resolved history.
- \`seevee export [--output <path>] [--json]\` — render the active template to PDF under \`exports/\`.
- \`seevee template list | draft | validate | compile | activate\` — the template lifecycle; the dashboard only renders the activated version.

Do not hand-roll work a command already does: no ad-hoc hashing, text extraction, PDF text pulls, validation, or layout measurement in shell or Python one-liners. Read a file with the file tools and inspect a document with a CLI command.

**Hard rules.**

- Never invent employers, dates, degrees, technologies, certifications, metrics, achievements, links, or contact data. Only user-stated or extracted facts belong in a CV; ask when evidence is missing, and keep provenance assertions pointed at nodes that exist.
- Preserve stable IDs. Never identify a node by array index or by a bare JSON pointer; resolve targets by stable node IDs and semantic selectors.
- CV content, presentation state, template source, provenance, and comments are separate documents. Use the narrowest mutation surface; a wording change is not a template change.
- A4 portrait, 210 mm × 297 mm, is only the default page profile — not a style constraint. Follow the user's requested paper by editing \`data.page\` in the presentation, never by scaling content to fake a size.
- The Studio dashboard is fixed product UI. Do not redesign it when asked to redesign a CV, and do not start a second dashboard: the editor is already running.
- Generated Astro/CSS is user-controlled presentation code inside Seevee's safety boundary — no filesystem, process, environment, arbitrary network, dynamic evaluation, endpoint, or package-install capability in a template.

**Mutation contract.** Read the target document and its \`revision\`, resolve targets by stable ID, apply the smallest typed operation set carrying \`baseRevision\`, revalidate the affected document, and reject the write if the revision moved underneath you — reread and rebase instead of overwriting. Write through a temporary sibling file and rename, so the dashboard never sees a half-written document.`;