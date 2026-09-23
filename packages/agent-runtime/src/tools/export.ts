import { z } from 'zod';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Render/export tools. Render and PDF export are mutations on the rendered
 * surface and intentionally stub until the review surface lands.
 */

const renderPreviewInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    presentationId: z.string().min(1),
  })
  .strict();

const renderPreviewOutput = z
  .object({
    artifactPath: z.string().min(1),
  })
  .strict();

const renderInspectLayoutInput = renderPreviewInput;

const renderInspectLayoutOutput = z
  .object({
    diagnostics: z.array(z.record(z.unknown())),
  })
  .strict();

const exportPdfInput = renderPreviewInput;

const exportPdfOutput = z
  .object({
    pdfPath: z.string().min(1),
  })
  .strict();

export const renderPreviewTool: ToolDefinition<typeof renderPreviewInput, typeof renderPreviewOutput> = {
  name: 'render.preview',
  description: 'Render a CV preview (mutation — review required).',
  input: renderPreviewInput,
  output: renderPreviewOutput,
  handler: async () => {
    throw mutationToolError('render.preview');
  },
};

export const renderInspectLayoutTool: ToolDefinition<typeof renderInspectLayoutInput, typeof renderInspectLayoutOutput> = {
  name: 'render.inspectLayout',
  description: 'Inspect a rendered layout for diagnostics (mutation — review required).',
  input: renderInspectLayoutInput,
  output: renderInspectLayoutOutput,
  handler: async () => {
    throw mutationToolError('render.inspectLayout');
  },
};

export const exportPdfTool: ToolDefinition<typeof exportPdfInput, typeof exportPdfOutput> = {
  name: 'export.pdf',
  description: 'Export a CV to PDF (mutation — review required).',
  input: exportPdfInput,
  output: exportPdfOutput,
  handler: async () => {
    throw mutationToolError('export.pdf');
  },
};

export const exportTools = [renderPreviewTool, renderInspectLayoutTool, exportPdfTool] as const;
