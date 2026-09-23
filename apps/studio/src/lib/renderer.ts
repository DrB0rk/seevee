/**
 * CV → physical pages renderer (stub).
 *
 * The full renderer lives in `packages/renderer/` and drives Playwright
 * headless Chromium to lay out a compiled template against an exact page
 * profile, then reports overflow / clipping / blank pages. Until that
 * package ships we expose a deterministic stub so the dashboard can
 * exercise the layout preview end-to-end without crashing.
 *
 * The stub returns a single A4 page containing zero blocks and a single
 * advisory diagnostic. It is intentionally conservative: callers can
 * rely on `exportReady: false` and `warnings` being non-empty so the UI
 * shows a placeholder instead of pretending the layout is real.
 */
import type { PresentationDocument } from '@seevee/schema';
import { resolvePageGeometry, type ResolvedPageGeometry } from './workspace.js';

export interface PageBlock {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Page {
  pageNumber: number;
  width: number;
  height: number;
  overflow: boolean;
  overflowAmount: number;
  blocks: PageBlock[];
}

export interface PageResult {
  pages: Page[];
  diagnostics: {
    overflow: boolean;
    clippedNodes: string[];
    blankPages: number[];
    warnings: string[];
  };
}

export interface RenderInput {
  cvId: string;
  presentation: PresentationDocument;
  /** Override the profile resolved from the presentation document. */
  profile?: 'A4' | 'Letter' | 'custom';
}

export async function renderCvToPages(input: RenderInput): Promise<PageResult> {
  const data = input.presentation.data;
  const geometry = resolvePageGeometry(data);
  const page: Page = {
    pageNumber: 1,
    width: geometry.widthMm,
    height: geometry.heightMm,
    overflow: false,
    overflowAmount: 0,
    blocks: [],
  };
  return {
    pages: [page],
    diagnostics: {
      overflow: false,
      clippedNodes: [],
      blankPages: [],
      warnings: ['renderer stub — real Playwright layout engine lands in P2'],
    },
  };
}

export interface InspectInput {
  presentation: PresentationDocument;
}

export interface InspectResult {
  pageCount: number;
  pageGeometry: ResolvedPageGeometry;
  diagnostics: PageResult['diagnostics'];
}

export function inspectPresentation(input: InspectInput): InspectResult {
  return {
    pageCount: 1,
    pageGeometry: resolvePageGeometry(input.presentation.data),
    diagnostics: {
      overflow: false,
      clippedNodes: [],
      blankPages: [],
      warnings: ['renderer stub — diagnostics reflect placeholder output only'],
    },
  };
}