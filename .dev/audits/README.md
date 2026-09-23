# Development audits

Audits in this directory assess the Seevee repository itself.

They are maintainer artifacts and are not copied into end-user workspaces.

## Naming

Use:

~~~text
YYYY-MM-DD_<scope>.md
~~~

Examples:

~~~text
2026-09-23_final-repository-audit.md
2026-10-04_schema-migration-audit.md
2026-10-18_release-readiness-audit.md
~~~

## Required audit metadata

Every audit should state:

- date;
- repository/ref inspected;
- scope;
- status;
- verified checks;
- findings by severity;
- fixed-in-audit items;
- remaining implementation work;
- explicit limitations.

## Severity

- **Critical** — unsafe release/data loss/security or fundamentally invalid architecture.
- **High** — major contract/runtime flaw that blocks implementation/release.
- **Medium** — correctness/maintainability issue that should be fixed before the affected feature ships.
- **Low** — polish, documentation, or non-blocking cleanup.
- **Info** — observation or future consideration.

## Status vocabulary

Use:

- Open
- Fixed
- Accepted
- Deferred
- Not implemented

Do not describe a specification as implemented unless production code and relevant tests exist.

## Audit discipline

An audit should fix clear low-risk inconsistencies while it is being performed where possible.

Do not leave duplicate canonical documents merely to preserve history. Git history is the archive.

When an audit changes architecture or policy, update the relevant canonical `.dev/` files in the same change.
