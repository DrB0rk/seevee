# Linked workspace example

This fixture demonstrates the core Seevee relationship model.

- `cv.json` contains the semantic CV graph.
- `sources/src_demo.json` contains normalized extraction blocks from an input source.
- `provenance.json` links the CV bullet `bul_demo:/text` back to `src_demo`.
- `presentation.json` renders the CV on A4 portrait at 210 x 297 mm.
- `comments.json` targets that same bullet using a FieldSelector first, then a TextQuoteSelector, then a revision-bound PageRegionSelector.
- `seevee.json` ties the canonical resources together.

An implementation test should reorder the experience/section, rerender it, and confirm that `thr_demo` still resolves through `bul_demo` without depending on the bullet's array position or page coordinates.

The fixture intentionally contains no agent-specific runtime configuration. Any external agent should be able to enter this directory, read the workspace guidance/contracts, edit through the supported mutation rules, and run `seevee validate --json`.
