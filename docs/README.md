# Seevee documentation map

There are two completely separate agent audiences in this repository.

## 1. Repository development agents

These agents build, test, refactor, review, or release **Seevee itself**.

Start with:

- `/AGENTS.md`
- `/docs/development/README.md`
- `/docs/development/IMPLEMENTATION_STATUS.md`

Development specifications live only under:

~~~text
docs/development/
schemas/
audits/
~~~

Do not use `skills/seevee-agent/` as instructions for developing the Seevee repository. That skill is product payload for end-user workspaces.

## 2. Workspace / CV agents

These agents run **inside a user's initialized Seevee workspace** and create, tailor, review, or redesign that user's CVs.

Canonical workspace-agent materials:

- `/skills/seevee-agent/` — distributable agent skill bundled/installed into workspaces.
- `/docs/workspace-agent/README.md` — repository-side explanation of that runtime audience.
- `/docs/workspace-agent/CV_GUIDANCE.md` — long-form researched CV guidance.

Workspace agents should not use `AGENTS.md` from this repository as their operational guide. `seevee init` must generate/copy a workspace-specific agent guide instead.

## Shared contracts

Both audiences may need to understand the public data contracts:

- `/schemas/v1/*.schema.json`
- `/schemas/README.md`

Repository-development agents implement and migrate them.
Workspace agents consume them.

## Public documentation

`/README.md` is the project overview and user-facing architecture summary.
