# Contributing to Seevee

Seevee is currently pre-1.0. Contributions should optimize for architectural clarity, correctness, and testability rather than compatibility with unimplemented behavior.

## Before opening a change

Read:

- `.dev/README.md`
- `.dev/IMPLEMENTATION_STATUS.md`
- `.dev/DEVELOPMENT.md`
- relevant spec under `.dev/specs/`

For schema changes, also read `schemas/README.md`.

## Branches

Use short-lived branches.

Suggested names:

~~~text
feat/<topic>
fix/<topic>
docs/<topic>
refactor/<topic>
test/<topic>
chore/<topic>
release/<version>
~~~

Do not maintain long-lived feature branches when a sequence of smaller reviewed changes is possible.

## Commit messages

Use Conventional Commits 1.0.0.

Examples:

~~~text
feat(cli): add detached workspace server startup
fix(schema): allow nested JSON Pointers
docs(dev): clarify release approval flow
refactor(renderer): separate page measurement from export
test(comments): cover target reordering
chore(release): prepare v0.2.0-alpha.1
~~~

Allowed common types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `perf`
- `build`
- `ci`
- `chore`
- `revert`

Use `!` or a `BREAKING CHANGE:` footer for breaking public-contract changes.

## Pull requests

A PR should:

- have one coherent purpose;
- explain user/runtime impact;
- identify affected contracts/schemas;
- include tests or explain why none are needed;
- update documentation when behavior changes;
- avoid unrelated formatting churn;
- call out migration requirements;
- state whether the change affects release notes.

Prefer squash merge once CI and review pass so the main branch history follows the same Conventional Commit grammar.

## Review checklist

Reviewers should verify:

- architecture boundary respected;
- repository-agent/workspace-agent separation preserved;
- schema/reference integrity preserved;
- security implications considered;
- no invented or duplicated data contract;
- tests cover meaningful failure cases;
- docs match implementation;
- user-visible behavior appears in CHANGELOG;
- release impact is correctly classified.

## Schema contributions

Schema changes require extra care because workspace files are public data.

A schema PR must include:

- compatibility classification;
- migration plan or reason migration is unnecessary;
- fixture updates;
- semantic validator updates;
- generated artifact updates once Zod becomes canonical;
- old-version compatibility test where supported.

## Agent-generated contributions

Agent-authored code is reviewed exactly like human-authored code.

Do not merge output simply because an agent reports that tests pass. CI and reviewer verification remain authoritative.

## No direct release from feature work

Normal feature PRs do not publish releases.

Releases follow `.dev/RELEASING.md`.
