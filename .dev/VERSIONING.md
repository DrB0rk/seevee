# Versioning policy

Seevee uses Semantic Versioning 2.0.0 for the application/runtime.

Reference: https://semver.org/spec/v2.0.0.html

## Product version

Canonical product version is stored in root `VERSION`.

Current pre-1.0 policy:

~~~text
0.MINOR.PATCH
~~~

Examples:

- `0.1.0` — first coherent pre-1.0 feature set
- `0.2.0` — backward-compatible feature milestone
- `0.2.1` — bug fix
- `0.3.0-alpha.1` — prerelease
- `0.3.0-beta.1`
- `0.3.0-rc.1`

Before 1.0, public contracts may still change, but breaking changes must be explicitly documented and migrated where supported.

## 1.0 and later

After 1.0:

- MAJOR: incompatible public API/workspace/CLI behavior;
- MINOR: backward-compatible functionality;
- PATCH: backward-compatible fixes.

## What counts as public product contract

At minimum:

- CLI commands/flags/exit codes;
- workspace directory model;
- canonical JSON resource semantics;
- local API/event contracts exposed to integrations;
- template SDK;
- workspace-agent tool/runtime interface;
- release artifact/install layout.

## Schema versions are independent

Each schema family has its own `schemaVersion`.

Example:

~~~text
app:                 0.4.0
seevee.cv:           1.1.0
seevee.comments:     1.2.0
seevee.presentation: 1.0.0
~~~

Do not bump every schema merely because the application version changes.

Schema version rules:

- MAJOR: incompatible accepted shape/semantics;
- MINOR: backward-compatible additions;
- PATCH: clarifications/constraints that do not break valid supported documents.

Supported incompatible schema transitions require deterministic migrations.

## Template versions

Source templates use SemVer independently.

Template version changes reflect the template's public token/binding/render contract, not the application version.

## Skill versioning

The workspace-agent skill ships with the product release and should record compatibility in release metadata once the runtime exists.

Do not create an independent version stream unless skill distribution becomes independently updateable.

## Release tags

Git tags:

~~~text
v0.1.0
v0.2.0-alpha.1
v1.0.0
~~~

Tag must exactly match root `VERSION` with a leading `v`.

## Changelog

Root `CHANGELOG.md` follows Keep a Changelog-style sections:

- Added
- Changed
- Deprecated
- Removed
- Fixed
- Security

Only user/developer-relevant changes belong there. Internal audit notes stay in `.dev/audits/`.
