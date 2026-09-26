# Design

## Source of truth

**Status:** Active  
**Date:** 2026-09-26
**Product surfaces:** Seevee Studio dashboard shell, CV editor, page canvas, agent workspace, settings, and public brand assets
**Evidence reviewed:** `README.md`, `.dev/specs/DASHBOARD_EDITOR.md`, `.dev/specs/DASHBOARD_VISUAL_DESIGN.md`, `apps/studio/src/layouts/Dashboard.astro`, `apps/studio/src/styles/dashboard.css`, the agent chat component, and `assets/brand/`.

The two dashboard specs define the detailed behavior. This file is the concise, product-level design contract. The user confirmed the panel order: **agent workspace on the left, CV section editor on the right, physical CV pages in the center.**

## Brand

Seevee is a focused, local-first CV studio. The interface should feel considered, capable, and quiet. Trust comes from visible save state, explicit agent activity, direct access to document facts, and an accurate physical-page preview.

The brand mark is two facing pages forming a V at their spine. It uses a navy tile, an off-white left page, and a single blue right page. The lowercase Fira Sans wordmark is supplied as vector outlines. Use the light or dark lockup for the surrounding surface; use the monochrome marks where color is unavailable. `assets/brand/README.md` is the asset and usage guide.

Avoid dashboard metrics, promotional cards, decorative gradients, excess chrome, opaque agent actions, and any dashboard styling that leaks into the rendered CV.

## Product goals

- Keep the CV page as the main visual focus.
- Make document edits, agent collaboration, comments, and export easy to find.
- Show what the agent is doing and make approvals and errors understandable.
- Keep light and dark themes structurally and semantically consistent.
- Preserve physical page dimensions regardless of viewport size.

Non-goals: built-in career scoring, hidden resume rules, template-imposed CV styling, and analytics dashboards.

Success signals: users can identify the active document and save state at a glance, edit a section without losing canvas context, understand agent status, and reach common canvas controls without covering the page.

## Personas and jobs

- **CV owner:** edit structured CV facts, compare the rendered page, and export a document.
- **Agent collaborator:** use the left conversation panel to make and review changes, answer questions, and handle approvals.
- **Template author:** inspect presentation behavior while preserving template control of the CV's visual design.

The primary context is desktop editing with a keyboard and pointer. Smaller screens support viewing, comments, and light edits.

## Information architecture

The persistent desktop shell has three work regions: agent conversation and activity on the left; a centered paged CV canvas; direct CV section editing, comments, reference files, and document settings on the right. A compact top bar carries workspace/document identity, save state, theme, settings, and export. Canvas controls float at the canvas edge.

Settings are secondary and open only when requested. The rendered CV is isolated from dashboard CSS. Responsive layouts keep the canvas central and present side panels as drawers rather than compressing the paper.

Settings use grouped navigation for workspace, agent, document, and product preferences. Keep the navigation visible in compact viewports, trap and restore keyboard focus while the dialog is open, and use the custom document selector in the top bar.

## Design principles

1. **Paper first:** preserve a clear visual path to the physical page.
2. **Stable geography:** agent left, canvas center, CV editor right.
3. **Useful density:** show related controls together, with progressive disclosure for infrequent settings.
4. **Visible state:** save, run, approval, error, and selection states use text or shape as well as color.
5. **One system, two themes:** semantic tokens drive both themes; components do not hard-code theme colors.
6. **No surprise edits:** dashboard preferences stay local; CV and presentation changes use their existing data APIs.

## Visual language

Use a restrained neutral palette with one blue accent and semantic status colors. Dark mode uses graphite surfaces with clear elevation steps; light mode uses cool white and gray surfaces with equivalent separation. Keep the center pasteboard distinct from both side panels. Use the existing UI font stack and compact, readable type. Use a 4px spacing rhythm, square panel edges, modest control radii, and shadows only for floating tools and dialogs. Motion is short and state-oriented. Avoid decorative grids, glow, and gradient effects.

Brand artwork uses navy `#182338`, blue `#5D8CFF`, off-white `#F7F9FC`, and ink `#172133`. Banner artwork is flat and document-led so it remains legible at social preview sizes. Keep descriptive copy outside the compact wordmark.

## Components

Keep `dashboard.css` as the owner of dashboard tokens and shell styles. Keep `agent-chat.css` scoped to chat components and consume shell tokens. Use Lucide icons consistently and accessible custom selectors for choice controls. Use GSAP for short, state-driven transitions and honor reduced motion. Preserve `AgentSidebar`, the canvas, and the right-side CV editor as distinct responsibilities. CV page styles remain template-owned.

## Accessibility

Target WCAG 2.2 AA for dashboard text and controls. All icon-only controls need accessible names; selection and status cannot rely on color alone. Preserve visible focus rings, semantic headings/regions, keyboard-reachable resize handles, and reduced-motion behavior. Keep desktop targets precise but comfortably operable; use larger touch targets on narrow screens.

## Responsive behavior

Desktop is the primary editing layout. At tablet widths, keep the canvas in the upper workspace with agent and editor panels below; at phone widths, stack canvas, agent, then editor. Avoid horizontal page overflow. The CV itself remains a scaled physical page, never a responsive reflow of its contents.

## Interaction states

Support loading, empty, saved, saving, failed, disabled, agent working, awaiting approval, and disconnected states. Keep errors next to the affected surface with actionable detail. Retain the current workspace error fallback when no `seevee.json` is available.

## Content voice

Use short, concrete labels that describe the action or document concept. Keep provider terminology where it is required to explain model or permission settings. Avoid marketing language and unexplained technical status codes.

## Implementation constraints

The dashboard is an Astro application with React agent chat. Existing DOM IDs and data attributes are consumed by dashboard scripts and must remain stable unless their handlers are updated in the same change. GSAP powers interaction motion; Lucide React supplies icons in Astro and React surfaces. Verify with Studio typecheck and browser inspection when a usable workspace is available; do not alter template-owned CV presentation styles.

## Open questions

- [ ] Should the compact left agent panel be hideable at desktop widths? Owner: product. Impact: canvas width and agent discoverability. The current redesign keeps it visible.
- [ ] Should keyboard shortcut help be exposed in the shell? Owner: product. Impact: toolbar density. Defer until a command palette exists.
