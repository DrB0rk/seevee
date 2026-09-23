# .dev — Seevee development control plane

Everything in this directory is for maintainers and agents developing **Seevee itself**.

Nothing under `.dev/` is intended to be copied into an end-user CV workspace.

## Start here

Development agents should read in this order:

1. `.dev/AGENTS.md`
2. `.dev/IMPLEMENTATION_STATUS.md`
3. `.dev/DEVELOPMENT.md`
4. task-specific spec under `.dev/specs/`
5. latest relevant audit under `.dev/audits/`

Human contributors should start with:

1. `.dev/CONTRIBUTING.md`
2. `.dev/DEVELOPMENT.md`
3. `.dev/VERSIONING.md`
4. `.dev/RELEASING.md`

## Structure

~~~text
.dev/
├── README.md
├── AGENTS.md
├── IMPLEMENTATION_STATUS.md
├── DEVELOPMENT.md
├── CONTRIBUTING.md
├── VERSIONING.md
├── RELEASING.md
├── QUALITY_GATES.md
├── specs/
│   ├── DEVELOPMENT_PLAN.md
│   ├── SCHEMA_ARCHITECTURE.md
│   ├── CLI_INSTALLER.md
│   ├── DASHBOARD_EDITOR.md
│   ├── DASHBOARD_VISUAL_DESIGN.md
│   ├── TEMPLATE_AUTHORING.md
│   └── WORKSPACE_AGENT_RUNTIME_SPEC.md
├── research/
│   └── TECHNICAL_REFERENCES.md
└── audits/
~~~

## Boundary with the actual product

The following remain outside `.dev/` because they are part of Seevee itself:

- `README.md`
- `VERSION`
- `CHANGELOG.md`
- `install.sh`
- `schemas/`
- `skills/seevee-agent/`
- `docs/workspace-agent/`
- `examples/`
- future application/runtime packages

The workspace-agent skill is product payload. It must not contain repository-development instructions.

## Canonical policy

If a development rule conflicts with an older comment, historical audit, or copied document, the current files in the root of `.dev/` take precedence.

Architecture-specific rules in `.dev/specs/` take precedence for their subsystem unless a newer audit explicitly records an approved change.
