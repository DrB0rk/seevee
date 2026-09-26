# Dashboard Visual Design Contract

Status: active application-shell visual contract
Date: 2026-09-25
Related: `/DESIGN.md`, `.dev/specs/DASHBOARD_EDITOR.md`

## 1. Scope

This contract covers Seevee Studio's application shell: workspace header,
agent chat, CV canvas, section editor, comments, document tools, and settings.
It does not prescribe the visual design of a CV. Templates own all CV page
layout, typography, color, imagery, and decoration. Application styles must
not leak into the rendered CV.

## 2. Product character

Seevee is a local-first document workstation. Its UI should feel precise,
capable, calm, and immediately understandable. The page preview is the main
visual object; the shell supplies useful controls around it.

Avoid decorative dashboard cards, broad empty hero regions, gradients,
glass effects, excessive shadows, neon accents, and generic analytics UI.
Use depth to distinguish working surfaces, not to decorate every control.

## 3. Geography and dimensions

The desktop order is fixed: **agent workspace left, CV page canvas center,
CV section editor right.**

~~~text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Seevee · workspace · active CV · save state · theme · settings · export     │
├──────────────────────┬────────────────────────────┬─────────────────────────┤
│ Agent workspace      │ Physical CV canvas         │ CV section editor       │
│ chat / activity      │                            │ sections / fields       │
│ tools / approvals    │        [paper pages]       │ comments / page tools   │
│ composer             │                            │ reference files         │
└──────────────────────┴────────────────────────────┴─────────────────────────┘
~~~

Primary desktop target: 1440 × 900. Top bar: 58 px. At 1360 px and above,
agent width is 460 px by default and CV editor width is 360 px. Between 982 px
and 1360 px, defaults are 360 px and 320 px. Minimum widths are 320 px and
280 px. Canvas minimum before reflow: 380 px. Side widths and zoom persist as browser-local
preferences. A new or reset document opens fitted to the available canvas;
manual zoom stays selected until the user chooses Fit again. Zoom range is
40–200%. Resizer tracks are visually 1 px with a larger keyboard and
pointer hit area.

## 4. Color tokens

`apps/studio/src/styles/dashboard.css` owns dashboard colors. Every shell and
agent-chat rule uses semantic tokens rather than fixed theme colors. Light mode
redefines these tokens; component structure and interaction states stay the
same.

### Dark theme

~~~text
surface.canvas        #121519
surface.sunken        #171B20
surface.panel         #1C2128
surface.raised        #242A32
surface.overlay       #2B323C
surface.input         #181D23
surface.hover         #303844
border.subtle         #252C35
border.default        #343D48
border.strong         #485462
text.primary          #F1F4F8
text.secondary        #C0C9D3
text.muted            #99A5B2
text.faint            #8995A2
accent                #78A7F5
accent.hover          #91B8FA
accent.soft           #243753
accent.border         #3C5C88
canvas.pasteboard     #101317
paper                 #FFFFFF
~~~

Status colors have a foreground, soft surface, and border token for success,
warning, danger, and informational states. Focus uses `--ring` and
`--ring-danger`.

### Light theme

Light mode uses the same semantic names under `[data-theme="light"]`:

~~~text
surface.canvas        #F7F8FA
surface.sunken        #EEF0F4
surface.panel         #FFFFFF
surface.raised        #FBFCFD
surface.overlay       #FFFFFF
surface.input         #FFFFFF
surface.hover         #F0F2F6
border.subtle         #ECEEF2
border.default        #DDE1E7
border.strong         #C3CAD3
text.primary          #10141A
text.secondary        #4A5563
text.muted            #626D7A
text.faint            #5E6875
accent                #2563EB
accent.soft           #EFF5FF
canvas.pasteboard     #E8EBF0
~~~

Keep control and status contrast readable in both themes. The default follows
the operating system until the user explicitly selects a theme. Store the
choice in `seevee.theme` and apply it before first paint.

## 5. Type and spacing

Use the existing system sans stack for application text and the existing mono
stack for IDs, counts, timestamps, and technical output. Body controls are
11–13 px; panel titles are 14–15 px; metadata is 10–11 px. Prefer sentence
case over uppercase labels except for small panel eyebrows. Use a 4 px spacing
base: 4, 8, 12, 16, 24, 32 px.

Panels meet flush with square outer edges. Controls use 6–8 px radii; cards and
dialogs use the existing scale up to 14 px. Keep the CV page square-cornered.
Reserve shadows for the paper, floating canvas rail, and dialogs.

## 6. Component language

- **Top bar:** one calm surface, clear workspace and document identity, visible
  save state, and a restrained primary export action.
- **Agent panel:** recognizable session picker, compact activity status,
  readable transcript, visible pending approval, and composer anchored at the
  bottom. User prompts and assistant responses have distinct but restrained
  surfaces.
- **Canvas bar:** document title and Preview/Edit segmented control.
- **Canvas rail:** compact floating tool group for comments and zoom. Pressed
  state has both accent fill and `aria-pressed` semantics.
- **Icons and selectors:** Lucide icons share a consistent 1.75 px stroke and
  16–18 px control size. Choice controls use the Seevee listbox treatment,
  visible focus, clear selected state, type-ahead, and Escape dismissal.
- **Agent conversation:** identify user and assistant messages at a glance;
  make live, waiting, approval, success, and failure states explicit in text.
  Keep the composer a distinct, attached work surface with a clear send action.
- **CV editor:** section navigation near the panel title, direct editing fields
  grouped by CV section, disclosures for repeated entries, comments, and
  collapsed reference/document settings.
- **Settings:** a labelled modal dialog with grouped navigation, icon-led
  entries, a scrollable content surface, and one concise save state. Trap
  keyboard focus while open and return it to the trigger on close.
- **Fields:** readable sentence-case labels, 36 px or taller inputs, quiet
  borders, clear hover and focus states.
- **Comments and approvals:** explicit status labels and semantic color;
  never communicate status with color alone.

Reuse existing components and DOM hooks. Do not add visual-only controls.

## 7. Canvas

Render physical paper at its configured dimensions, centered on a distinct
pasteboard. Preserve page proportions while scaling to fit. Keep a subtle paper
edge and shadow so page boundaries remain clear in both themes. Comments and
semantic selections sit above the rendered page without obscuring broad areas.

## 8. Responsive behavior

Desktop is the editing target. At 982 px and below, keep the canvas in the
large upper region and put agent/editor panels in a lower split region. At
640 px and below, stack canvas, agent workspace, and CV editor
vertically. Side panels remain visible; do not hide them behind controls that
do not exist. The page remains a scaled physical page on every viewport.

On touch sizes, controls grow to at least 42 px. Avoid horizontal overflow and
keep panel headings and primary actions reachable.

## 9. Motion and feedback

Use 100–160 ms transitions for hover/focus and up to 220 ms for panel changes.
Motion reports actual state changes; do not animate streamed tokens or paper
position during ordinary render updates. Honor `prefers-reduced-motion`.

Save, loading, error, disconnected, agent working, waiting for approval, and
complete states remain understandable through text and shape as well as
color. Keep errors near their cause and preserve enough detail to act.

## 10. Accessibility

- Target WCAG 2.2 AA for normal dashboard text.
- Label icon-only controls and provide tooltips where the function is not
  obvious.
- Keep keyboard focus visible and controls keyboard reachable.
- Use semantic regions, headings, tabs, dialogs, live status, and pressed
  states.
- Expose resize handles to keyboard and assistive technology.
- Respect reduced motion and maintain non-color-only state communication.

These rules govern the dashboard shell. They do not rewrite user templates;
template accessibility is reported independently.

## 11. Acceptance criteria

- Agent remains left, page remains center, CV editor remains right.
- The page remains the dominant visual target at 1440 × 900 and larger.
- At 1280 × 720, all primary regions and controls remain usable.
- Light and dark modes have the same hierarchy and usable controls, focus,
  comments, approvals, and dialogs.
- Empty, loading, error, disabled, and active states are polished alongside
  the default state.
- Existing document, agent, comment, settings, and export interactions remain
  functional.
- The editor adapts without clipping at tablet and phone widths.
- Dashboard styles do not alter the CV rendered by the selected template.
