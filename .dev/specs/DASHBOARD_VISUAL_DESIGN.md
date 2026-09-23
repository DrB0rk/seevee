# Dashboard Visual Design Guide

Status: normative application-shell design guide
Date: 2026-09-23

## 1. Scope

This guide defines the Seevee application shell only.

It does **not** define how a CV itself must look. CV layout, typography, colour, composition, ornament, columns, imagery and section arrangement are entirely controlled by the selected template and by the user/agent creating that template.

The dashboard must never impose a house style on rendered CV pages.

A template may be:

- a generic reusable resume layout;
- a sector-specific layout;
- an ATS-oriented conservative layout;
- a highly visual portfolio layout;
- a multi-column technical CV;
- a bespoke layout optimized around one exact CV;
- anything else the user and agent can implement safely in Astro/CSS.

Seevee provides diagnostics and advisory standards. It does not reject a design merely because it is unconventional.

## 2. Product character

The dashboard is a professional document workstation around the CV canvas.

It should feel:

- precise;
- calm;
- technical;
- fast;
- information-dense without feeling cramped;
- visually subordinate to the CV.

Avoid:

- large marketing-style cards;
- excessive rounded corners;
- decorative gradients;
- glassmorphism;
- large empty hero areas;
- playful motion;
- colourful dashboard chrome;
- generic analytics-dashboard card grids.

The primary visual contrast is intentional: dark application chrome surrounding bright physical paper.

## 3. Desktop layout

Primary target: 1440 x 900 and larger.

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 52 px top bar                                                              │
├──────┬────────────────────┬───────────────────────────────┬──────────────────┤
│ 48px │ 264 px left panel  │          canvas              │ 336 px inspector │
│ rail │                    │                               │                  │
│      │ CVs                │       ┌─────────────┐         │ Context          │
│      │ Sources            │       │   CV page   │         │ Comments         │
│      │ Templates          │       │             │         │ Audit            │
│      │ History            │       └─────────────┘         │                  │
│      │ Agent runs         │                               │                  │
├──────┴────────────────────┴───────────────────────────────┴──────────────────┤
│ 28 px status bar                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

Default dimensions:

- top bar: 52 px;
- activity rail: 48 px;
- left panel: 264 px;
- right inspector: 336 px;
- bottom status bar: 28 px;
- side-panel minimum width: 220 px;
- useful canvas minimum width: 520 px.

Left and right panels are resizable and independently collapsible.

Panel geometry, open tabs and zoom are local UI preferences. They are not written to CV or presentation JSON.

## 4. Application palette

Default dashboard theme is dark.

~~~text
app.background        #0F1113
panel.background      #15181B
panel.elevated        #1B1F23
control.background    #20252A
control.hover         #272D33
separator             #2D333A
text.primary          #F2F4F6
text.secondary        #AAB1B9
text.muted            #747D86
accent                #4C8DFF
accent.hover          #6AA0FF
danger                #E86666
warning               #D6A84B
success               #65B889
canvas.pasteboard     #0B0D0F
paper                 #FFFFFF
paper.edge            #D7DBDF
~~~

Use semantic CSS tokens. Do not scatter literal colours throughout components.

The dashboard theme must not cascade into the CV render iframe/root. Template CSS and application CSS are isolated.

## 5. UI typography

Application UI:

~~~text
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
~~~

Monospace metadata:

~~~text
"JetBrains Mono", "SFMono-Regular", Consolas, monospace
~~~

Recommended scale:

- 11 px: metadata, shortcuts, secondary status;
- 12 px: standard controls and inspector labels;
- 13 px: lists and body UI;
- 14 px: panel title;
- 16 px: exceptional dialog title;
- 20 px+: do not use in routine editor chrome.

Default line height: 1.35–1.45.

Do not use the dashboard font as an implicit CV font.

## 6. Spacing and geometry

Use a compact 4 px base scale:

~~~text
4 / 8 / 12 / 16 / 24 / 32
~~~

Controls:

- compact height: 28 px;
- normal height: 32 px;
- toolbar icon button: 30 x 30 px;
- primary export/run action: 32–34 px;
- corner radius: 5–7 px;
- tooltip radius: 5 px;
- panel corners: square; panels meet the application frame.

The CV page itself has no application border radius. It represents physical paper.

## 7. Activity rail

Persistent activity modes:

1. CVs
2. Sources
3. Templates
4. Comments
5. History
6. Agent runs
7. Diagnostics
8. Settings

Use 18 px line icons.

Selected state:

- subtle elevated fill;
- 2 px accent indicator;
- high-contrast icon;
- tooltip containing label and shortcut.

Do not permanently show labels inside the 48 px rail.

## 8. Top bar

Left group:

- Seevee mark;
- workspace name;
- active CV selector;
- save/validation state.

Center group:

- active template;
- active presentation/style preset;
- page count;
- zoom control.

Right group:

- comment mode;
- diagnostics toggle;
- undo/redo;
- run/fix comments;
- Export PDF.

The top bar must not become the styling inspector.

## 9. Left panel

### CVs

The CV browser is the primary content switcher.

Each row shows:

- CV name;
- optional target label, for example "Backend roles";
- modified time/state;
- active presentation/template summary;
- warning count when relevant.

Actions:

- New CV
- Duplicate CV
- Rename
- Archive
- Delete with confirmation
- Reveal/open JSON file
- Create presentation from template

Every CV is stored as its own JSON file.

### Sources

Show imported files, URLs and extraction status.

### Templates

Show:

- built-in templates;
- workspace templates;
- style presets;
- advisory compatibility labels;
- template source version.

A template marked "bespoke" may still be applied to another CV. Show a warning, never a compatibility hard-block solely because it was designed for another CV.

### History / agent runs

Use compact chronological rows rather than analytics cards.

## 10. Canvas

The center canvas is the dominant workspace.

Default behavior:

- dark pasteboard;
- centered physical pages;
- 32 px vertical page gap;
- subtle page shadow;
- selectable semantic bindings;
- comment markers;
- diagnostic overlays hidden unless requested.

Controls:

- Fit page
- Fit width
- 50–200% zoom
- Previous/next page
- Page count
- optional spread view later

Default document profile remains A4 portrait, 210 x 297 mm, but this is a starting profile only. Presentations/templates may use Letter or arbitrary custom dimensions.

The CV render must be isolated from application CSS, preferably using an iframe or equivalent style boundary.

## 11. Right inspector

The inspector is contextual.

Tabs:

- Properties
- Comments
- Diagnostics

### Properties

When nothing is selected:

- page profile;
- active template;
- template-exposed controls;
- export settings.

When a semantic element is selected:

- node/field identity;
- content summary;
- source/provenance status;
- template-exposed element controls, if any;
- "Ask agent to modify" action.

A template is not required to expose dashboard-editable visual tokens. A bespoke template may expose zero controls and rely entirely on source edits by the user's chosen agent.

### Comments

Show threads linked to the selected target first, then all document threads.

### Diagnostics

Show concrete product/runtime diagnostics such as:

- schema/reference errors;
- unresolved or stale comment targets;
- missing sources/provenance where the workflow expects them;
- template compilation failures;
- missing fonts/assets;
- clipping/overflow;
- broken links or failed asset loads;
- PDF/export failures;
- file-watcher or workspace conflicts.

CV writing standards and career best practices do not run here as hidden product rules. When the user asks their agent to review a CV, the agent may use the repository's agent-facing guidance and create ordinary comments or proposed changes that remain visible and explainable.

## 12. Comments interaction

Comment mode:

1. user clicks a semantically bound element or drags a region;
2. target highlight appears;
3. compact composer opens near the target;
4. comment is saved;
5. full thread appears in the right panel.

Pins:

- accent: open;
- warning: blocked/orphaned;
- muted: resolved.

Do not use large sticky-note overlays that obscure the CV.

## 13. Agent review and diagnostics

There is no built-in CV-standard profile selector and no resume quality score.

Technical diagnostics come from Seevee itself. Editorial/career review comes from the user's chosen agent.

When asked to review a CV, an agent may consult `docs/workspace-agent/CV_GUIDANCE.md`, inspect the current CV/template/render, and then:

- add comments;
- propose content edits;
- propose a different layout;
- create a tailored CV variant;
- create/fork a template;
- explain trade-offs.

The dashboard displays those explicit comments/changes like any other collaboration artifact. It does not silently enforce career advice.

## 14. Status bar

Keep the bottom bar compact.

Left:

- workspace root;
- active CV filename;
- active schema version.

Center:

- render status;
- page dimensions;
- page count.

Right:

- server state;
- watcher state;
- agent run state;
- diagnostics count.

Use text plus small status glyphs. Never rely only on colour.

## 15. Modal and popover rules

Prefer inline panels and popovers for routine editing.

Use modals only for:

- destructive delete;
- export settings;
- template creation/forking;
- source import requiring options;
- migration/conflict resolution.

Dialogs max width: roughly 520–680 px unless a complex diff requires more.

## 16. Motion

Motion should communicate state, not decorate.

- 100–160 ms hover/focus transitions;
- 160–220 ms panel transitions;
- no spring/bounce effects;
- respect reduced-motion settings;
- page render updates should not animate scale/position unless zoom itself changed.

## 17. Keyboard model

Suggested shortcuts:

~~~text
Ctrl/Cmd + K        command palette
Ctrl/Cmd + S        validate/commit current dashboard edit
Ctrl/Cmd + Z        undo
Ctrl/Cmd + Shift+Z  redo
C                   comment mode
A                   audit mode
F                   fit page
Shift+F             fit width
+ / -               zoom
Ctrl/Cmd + E        export
Esc                 cancel/clear selection
~~~

Do not hijack browser-standard shortcuts unnecessarily.

## 18. Responsive behavior

Desktop is the editing target.

Below roughly 1000 px:

- left panel becomes an overlay drawer;
- right inspector becomes an overlay drawer;
- canvas remains central;
- top bar condenses labels into icons;
- physical page scaling remains accurate.

Mobile is primarily for viewing, comments and light edits. Do not turn the CV into a responsive web layout; preserve its physical-page representation.

## 19. Accessibility

Dashboard requirements:

- keyboard reachable controls;
- visible focus rings;
- labelled icon-only buttons;
- 4.5:1 normal-text contrast where applicable;
- non-colour-only status semantics;
- pointer target sizes appropriate for desktop precision;
- screen-reader labels for comment and diagnostic anchors;
- reduced motion support.

These dashboard requirements do not forcibly rewrite the CV template. CV accessibility is reported separately by audit rules.

## 20. Component inventory

Build reusable primitives before feature screens:

- Button
- IconButton
- SegmentedControl
- Select
- Combobox
- TextInput
- NumberInput
- Slider
- Switch
- Tabs
- Tree/List
- ContextMenu
- Tooltip
- Popover
- Dialog
- Toast
- StatusBadge
- ResizablePanel
- EmptyState
- CommandPalette

CV-specific:

- PageCanvas
- PhysicalPage
- SemanticSelectionOverlay
- CommentPin
- DiagnosticMarker
- CVList
- TemplateList
- AuditFinding
- AgentRunRow

## 21. Design acceptance criteria

The dashboard design is complete when:

- CV pages remain the strongest visual object on screen;
- application chrome is consistent and compact;
- users can switch among multiple CV JSON documents quickly;
- templates can be applied/forked without changing CV data;
- bespoke CV templates are fully supported;
- comments can be added without obscuring the document;
- technical diagnostics are understandable without a synthetic resume score;
- layout/render failures are visually distinct from career-advice warnings;
- the dashboard never forces a visual style onto CV templates;
- the design remains usable at 1280 x 720 and strong at 1440 x 900+.
