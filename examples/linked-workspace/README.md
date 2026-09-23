# Linked workspace example

This fixture demonstrates the multi-CV relationship model.

- `cvs/demo.json` is one independent semantic CV document.
- `sources/src_demo.json` contains normalized extraction blocks from an input source.
- `provenance/demo.json` links the CV bullet `bul_demo:/text` back to `src_demo`.
- `comments/demo.json` targets that same bullet using a FieldSelector first, then textual/rendered fallbacks.
- `presentations/demo.json` explicitly binds `cv_demo` to a template/version and renders it as A4.
- `seevee.json` indexes the CV, presentation, provenance and comments resources.

A workspace can add another complete CV, for example `cvs/backend.json`, without cloning template source. It can create another presentation that binds either CV to any available template.

An implementation test should reorder the experience/section, rerender it, and confirm that `thr_demo` still resolves through `bul_demo` without depending on array position or page coordinates.

The fixture intentionally contains no agent-specific runtime configuration. Any external agent should be able to enter this directory, read the workspace guidance/contracts, edit through the supported mutation rules, and run `seevee validate --json`.
