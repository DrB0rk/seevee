# Dashboard Editor Contract

Status: active product UX contract
Date: 2026-09-25

The detailed visual language, tokens, and interaction patterns live in
`.dev/specs/DASHBOARD_VISUAL_DESIGN.md`. Product-level goals and accessibility
principles live in `/DESIGN.md`.

## 1. Product boundary

Seevee Studio is a stable editor shell around a real, template-rendered CV.
Dashboard controls help a person inspect and edit structured CV data, work with
an agent, comment on rendered content, and export the result. The active
template owns the CV's typography, color, layout, and decoration. Dashboard
styles must never leak into the rendered page.

The agent can propose or make document changes through the existing workspace
APIs. The interface must keep agent activity visible and preserve direct human
editing. It must not invent a CV score or silently enforce career advice.

## 2. Stable workspace geography

Desktop uses three persistent work areas in this order:

~~~text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Workspace · document · save state · theme · settings · export               │
├──────────────────────┬────────────────────────────┬─────────────────────────┤
│ Agent workspace      │ Physical CV canvas         │ CV section editor       │
│ conversation          │                            │ fields / comments        │
│ activity and tools    │        [paper pages]       │ reference / page tools   │
│ composer              │                            │                          │
└──────────────────────┴────────────────────────────┴─────────────────────────┘
~~~

The agent workspace is always on the **left**. The physical-page canvas stays
in the **center**. CV sections, comments, references, and document settings are
on the **right**. Never reverse the agent and document editor panels.

At 1440 px and wider, use 460 px for the agent panel and 360 px for the CV
editor by default. Both are independently resizable and persist locally. Keep
at least 380 px for the canvas before reflow. Between 982 px and 1360 px, use
360 px for agent and 320 px for the CV editor by default, retaining at least
380 px for the canvas. Resizers must remain keyboard reachable and announce
their value.

## 3. Top bar

Keep the top bar compact. It identifies Seevee, the workspace, active CV,
save/connection state, theme, settings, and PDF export. Give the active
document and save state clear priority. Do not fill this row with styling
controls or disabled mock actions.

The canvas bar identifies the preview and provides Preview/Edit mode. Zoom,
fit, and comment placement belong in the floating canvas tool rail.

Settings opens as a focused dialog, grouped by workspace, agent, document, and
about. It presents one concise save state, traps keyboard focus while open,
and returns focus to the trigger on close. The active document picker uses the
same custom selector treatment as other choice controls.

## 4. Agent workspace (left)

One provider-neutral conversation shows the selected session, streamed
responses, plans, tool activity, usage, workspace changes, validation,
questions, and approval requests. Provider/model/permission setup belongs in
Settings and the existing composer controls. Do not duplicate provider
selection in the transcript.

Keep messages readable and distinguish user prompts, assistant responses,
activity, errors, and approval requests. Technical details can be disclosed
inline. The composer remains attached to the bottom edge and must not obscure
the last message. Empty, disconnected, working, waiting, complete, and failed
states stay legible in both themes.

## 5. CV canvas (center)

Render the actual CV as physical pages, not a screenshot or responsive web
layout. The default profile is A4 portrait, 210 × 297 mm; Letter and custom
profiles remain possible. The pasteboard separates pages from application
chrome and keeps paper visually dominant.

Provide the existing preview/edit modes, zoom readout, zoom in/out, fit-page,
and comment placement. Preserve semantic selections and visible comment
markers. Keep diagnostic overlays hidden unless requested. Never apply the
dashboard theme to CV content. New or reset workspaces start fitted to canvas
width; manual zoom is preserved until the user asks to fit again. Support
40–200% zoom.

## 6. CV editor (right)

Keep section navigation close to the content it selects. Direct fields are
grouped under clear section headings; individual experience or education
entries use disclosures. Labels are readable sentence case. Save behavior is
explained once near the panel heading rather than repeated on every field.

Comments remain reachable without covering the page. Reference uploads and
document settings stay available in a collapsed tools area so routine editing
keeps focus. Page controls include paper size, orientation, margins, font,
line height, and accent color as supported by the active presentation.

Do not render template source code or imply that every template supports
arbitrary layout controls.

## 7. Visual and theme system

Use the semantic token system in `apps/studio/src/styles/dashboard.css` for
surfaces, borders, text, accent, status, focus, and elevation. Agent chat uses
the same tokens from `agent-chat.css`. Theme selection changes token values,
not component structure. Both themes preserve equal hierarchy and usable
contrast.

Use compact, precise controls and a calm neutral shell. Panels meet at clear
edges; reserve rounded corners and shadow for controls, floating tools, and
dialogs. The paper sits on a distinct pasteboard. Avoid excessive cards,
glow, gradients, and decoration that compete with the CV.

## 8. Responsive behavior

Desktop is the primary editing target. At the tablet breakpoint, keep the
canvas as the first large work area and arrange agent/editor panels below it
side by side when space permits. On narrow phones, stack canvas, agent, then
CV editor into scrollable regions. Keep panel headings and key actions
available; do not create inaccessible drawers without visible open/close
controls. Scale the paper without reflowing its contents.

## 9. Interaction and accessibility

- Every icon-only control has an accessible name and tooltip/title.
- Keyboard focus is visible and uses the shared focus token.
- Status uses text or shape as well as color.
- Use semantic headings, labelled regions, dialogs, and live status messages.
- Honor `prefers-reduced-motion`; transitions communicate state only.
- Use 44 px minimum touch targets on narrow screens.
- Keep focus within an open modal and return focus to its trigger on close.

Loading, empty, saved, saving, error, disabled, offline, and pending-approval
states are designed with the same visual system as the default state.

## 10. Controls, icons, and motion

Use Lucide icons consistently for dashboard actions and navigation. Icons are
decorative when paired with a visible label; icon-only buttons require an
accessible name and tooltip. Do not use text glyphs as action icons.

All choice controls use a Seevee-styled, keyboard-operable selector with the
same selected, disabled, focus, and open states in both themes. Keep the
underlying form value and change events in sync with the visible choice.

Use GSAP for short, state-driven transitions: opening a menu or dialog,
revealing a new message, and confirming a status change. Motion must not delay
actions, loop without user intent, or move the canvas while the user is editing.
Honor `prefers-reduced-motion` by removing nonessential transitions.

## 11. Acceptance criteria

- Agent chat remains on the left, the physical page remains central, and CV
  section editing remains on the right.
- At 1280 × 720, all three areas remain usable; at 1440 × 900 the paper is the
  clearest focal point.
- Light and dark mode use the same component hierarchy and have readable
  controls, statuses, focus rings, dialogs, and chat content.
- Existing document, comments, agent, settings, and export interactions keep
  their behavior and stable DOM hooks.
- Narrow layouts avoid clipped panels and horizontal page overflow.
- Dashboard styling remains isolated from the template-rendered CV.
- Action icons use Lucide; selectors are styled and keyboard accessible; chat
  status and message ownership are immediately distinguishable.
- GSAP interactions remain brief, purposeful, and respect reduced motion.
