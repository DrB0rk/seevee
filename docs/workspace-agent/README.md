# Workspace / CV agent documentation

Audience: agents operating inside an end user's Seevee workspace.

These agents work on CV content, sources, comments, presentations, and user-owned Astro templates. They do **not** develop the Seevee application itself.

## Canonical runtime package

The canonical operational bundle is:

~~~text
skills/seevee-agent/
├── SKILL.md
├── agents/openai.yaml
└── references/
~~~

`seevee init` should install or generate equivalent workspace-facing instructions under the user's project directory.

## Repository-only reference

`CV_GUIDANCE.md` contains the long-form researched CV/resume guidance used to maintain the shorter skill reference.

It is advisory writing/review knowledge, not product validation logic.

## Never copy repository developer instructions into user workspaces

Do not copy this repository's root `AGENTS.md` into a user's workspace. It is specifically for developing Seevee.

The workspace guide produced by `seevee init` must instead direct agents to:

- the active `seevee.json`;
- the selected `cvs/<cv-id>.json`;
- related provenance/comments/presentation files;
- local templates;
- bundled workspace-agent skill/reference material;
- `seevee validate --json`.

## Scope

Workspace agents may:

- ingest source material;
- create or tailor CV JSON files;
- edit copy without inventing facts;
- use provenance;
- apply comments;
- create or modify user-owned Astro/CSS templates;
- change presentation/page settings;
- render/inspect/export through Seevee commands.

Workspace agents must not:

- modify Seevee's installed runtime implementation;
- edit runtime PID/port state manually;
- reinterpret repository development plans as workspace instructions;
- turn CV best-practice guidance into hidden product rules.
