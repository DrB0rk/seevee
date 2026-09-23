# Repository development documentation

Audience: agents and humans implementing the Seevee repository itself.

This directory is **not** copied into end-user CV workspaces.

## Read order

For a non-trivial implementation task:

1. `/AGENTS.md`
2. `IMPLEMENTATION_STATUS.md`
3. Relevant specification below
4. `/schemas/README.md` and affected schemas
5. Latest audit under `/audits/`

## Specifications

| File | Responsibility |
|---|---|
| `DEVELOPMENT_PLAN.md` | Product architecture and phased build plan |
| `SCHEMA_ARCHITECTURE.md` | Canonical resource/reference design |
| `CLI_INSTALLER.md` | GitHub installer, CLI and detached server lifecycle |
| `DASHBOARD_EDITOR.md` | Functional editor/dashboard behavior |
| `DASHBOARD_VISUAL_DESIGN.md` | Fixed dashboard visual system |
| `TEMPLATE_AUTHORING.md` | Astro template/runtime contract |
| `WORKSPACE_AGENT_RUNTIME_SPEC.md` | Product-side runtime behavior and tool boundary for workspace agents |
| `RESEARCH_REFERENCES.md` | Primary technical references used by the architecture |

## Boundary with workspace-agent docs

The following are **not repository-development instructions**:

- `/skills/seevee-agent/`
- `/docs/workspace-agent/CV_GUIDANCE.md`

Those describe how an end-user's agent should operate once Seevee exists.

A repository-development agent may inspect them when implementing the runtime contract, but must not mistake their instructions for repository contribution rules.
