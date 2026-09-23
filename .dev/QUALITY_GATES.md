# Quality gates

These gates become mandatory as their corresponding implementation exists.

## Every PR

- formatting
- lint
- typecheck
- unit tests
- no broken documentation links
- no accidental edits to generated artifacts
- no stale developer docs outside `.dev/`

## Schema-affecting PR

- JSON Schema parses
- internal `$ref` resolution
- canonical Zod generation check once implemented
- semantic validator tests
- fixture validation
- migration tests
- backward-compatibility classification

## CLI/runtime PR

- Linux lifecycle integration test
- stale PID protection test
- no interactive prompt in routine commands
- machine-readable `--json` contract tests

## Renderer/template PR

- sparse/normal/dense fixture render where applicable
- bespoke-template target fixture when applicable
- clipping/overflow diagnostics
- semantic binding validation
- PDF geometry/export test
- template sandbox/security tests

## Installer/release PR

- shellcheck or equivalent shell static check
- platform installer smoke test
- checksum verification failure test
- version pin test
- install/uninstall/update/rollback lifecycle where supported

## Documentation

Documentation is part of the product contract.

A link/reference audit must fail CI when canonical docs point at removed files.
