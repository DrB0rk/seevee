# Seevee

Seevee is an agent-driven CV creation environment.

An agent ingests user-provided sources into a structured, provenance-aware CV document. A separate design agent can create Astro CV templates that render that data. A fixed dashboard provides a robust page editor, live preview, comments, template/style management, validation and PDF export.

The data contracts are the core of the project. CV content, presentation, templates, provenance and review comments are separate versioned resources linked through stable semantic IDs.

Default document profile: ISO A4 portrait, 210 x 297 mm.

## Architecture documents

- docs/DEVELOPMENT_PLAN.md — product architecture and implementation roadmap.
- docs/SCHEMA_ARCHITECTURE.md — normative schema design and cross-document reference model.
- docs/DASHBOARD_EDITOR.md — fixed dashboard/editor UX and live-preview behavior.
- docs/TEMPLATE_AUTHORING.md — Astro template contract, compiler lifecycle and sandbox rules.
- docs/AGENT_CONTRACT.md — agent roles, mutation boundaries and validation workflow.
- docs/CLI_INSTALLER.md — installer, `seevee` CLI, workspace scaffold and detached dashboard runtime.
- AGENTS.md — repository instructions for coding agents.
- skills/seevee-agent/ — reusable Seevee operating skill for agents.

## Install and initialize

The target user experience is:

~~~sh
npm install -g @drb0rk/seevee
mkdir my-cv
cd my-cv
seevee init
~~~

The package name may change to another official scope before publication, but the installed executable remains `seevee`.

`seevee init` is non-interactive: it scaffolds the local workspace, starts the dashboard in the background, opens the browser, and exits. The user can then launch any external agent in the directory.

## Core flow

1. Ingest text, documents, URLs, profile exports or images.
2. Normalize extracted information into canonical CV JSON.
3. Preserve source evidence in provenance JSON.
4. Select, create or compile an Astro source template.
5. Render physical CV pages in the fixed dashboard.
6. Adjust safe presentation controls or save style presets.
7. Comment directly on semantic content or rendered regions.
8. Let the agent apply comments through revision-safe typed changes.
9. Validate layout and export the same render contract to PDF.

This repository currently contains the architecture and agent contracts. Implementation should follow these documents rather than inventing parallel data shapes.
