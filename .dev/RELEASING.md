# Release process

Releases are deliberate maintainer actions. CI may build/publish after approval; normal merged PRs must not automatically publish a production release.

Primary distribution is GitHub Releases.

## Preconditions

Before preparing a release:

1. main branch is green;
2. `.dev/IMPLEMENTATION_STATUS.md` is accurate;
3. user-visible changes are documented in `CHANGELOG.md`;
4. schema migrations/compatibility are complete;
5. workspace-agent bundle is synchronized with runtime behavior;
6. installer/release integration tests pass;
7. no known blocking security/render/data-integrity issue remains.

## Determine version

Use `.dev/VERSIONING.md`.

Update root `VERSION`.

If releasing schema changes, update only affected schema-family versions.

## Release PR

Create `release/vX.Y.Z`.

The release PR should contain only release preparation:

- `VERSION`;
- CHANGELOG finalization;
- generated artifacts;
- schema migration artifacts if required;
- compatibility matrix/status updates;
- release metadata.

Commit example:

~~~text
chore(release): prepare v0.2.0
~~~

## Release CI gates

Required when implemented:

- format/lint;
- TypeScript typecheck;
- unit tests;
- schema generation/diff;
- semantic fixture validation;
- migration tests;
- CLI integration tests;
- renderer/export tests;
- template security tests;
- installer lifecycle tests on Linux/macOS/Windows;
- build all release artifacts;
- smoke-test each artifact;
- checksum generation.

## Artifact naming

Target release assets:

~~~text
seevee-linux-x64.tar.gz
seevee-linux-arm64.tar.gz
seevee-darwin-x64.tar.gz
seevee-darwin-arm64.tar.gz
seevee-windows-x64.zip
SHA256SUMS
~~~

Each runtime bundle includes at minimum:

~~~text
VERSION
bin/seevee
runtime/...
~~~

## Publish

After the release PR merges:

1. create signed/annotated tag if supported by maintainer setup: `vX.Y.Z`;
2. GitHub Actions builds from that tag;
3. CI verifies root VERSION matches tag;
4. CI uploads artifacts and SHA256SUMS;
5. CI creates a draft GitHub Release;
6. maintainer verifies install/smoke tests against the draft assets;
7. maintainer publishes the GitHub Release.

Do not publish artifacts built from an untagged working tree.

## Release notes

Release notes should summarize:

- user-visible additions;
- behavior changes;
- fixed defects;
- schema/migration notes;
- CLI changes;
- security changes;
- known issues.

Do not dump raw commit history without context.

## Prereleases

Use SemVer prerelease identifiers:

~~~text
v0.3.0-alpha.1
v0.3.0-beta.1
v0.3.0-rc.1
~~~

GitHub Release must be marked prerelease.

The default installer should resolve the latest stable release, not a prerelease.

## Hotfix

For a production regression:

1. branch from the affected stable tag/main state as appropriate;
2. implement minimal fix + regression test;
3. bump PATCH;
4. update CHANGELOG;
5. run full release gates;
6. publish normally.

Do not bypass integrity checks for urgency.

## Rollback

Install layout should keep previous versions.

If a release is bad:

- stop recommending it;
- mark release notes clearly;
- publish a fixed PATCH rather than mutating existing immutable artifacts;
- allow users to install a known version using the installer `--version` option.

Never replace an existing GitHub Release asset under the same version with different bytes.
