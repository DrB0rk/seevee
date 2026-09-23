# Seevee product documentation

This directory contains documentation that belongs to the Seevee product/runtime side of the repository.

Repository-maintainer documentation is isolated under `.dev/`.

## Workspace-agent documentation

- `workspace-agent/README.md` — explains the end-user workspace-agent scope.
- `workspace-agent/CV_GUIDANCE.md` — long-form researched CV/resume guidance used by workspace agents.

The distributable operational skill is:

~~~text
skills/seevee-workspace-agent/
~~~

## Important separation

Agents developing the Seevee repository should not use these workspace-agent documents as contribution instructions. They should start at:

~~~text
.dev/AGENTS.md
~~~

Agents creating or editing a user's CV should not use `.dev/` as runtime guidance.
