import { z } from 'zod';
import path from 'node:path';
import type { ToolDefinition } from '../types.js';

/**
 * Sources tools — `sources.list` enumerates source ids registered in the
 * workspace; `sources.readExtract` reads the canonical extracted document
 * (`sources/extracted/<id>.json`).
 */

const sourcesListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const sourcesListOutput = z
  .object({
    sources: z.array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
      }),
    ),
  })
  .strict();

const sourcesReadExtractInput = z
  .object({
    workspaceRoot: z.string().min(1),
    sourceId: z.string().min(1),
  })
  .strict();

const sourcesReadExtractOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
  })
  .strict();

async function readWorkspace(workspaceRoot: string, readFile: (path: string) => Promise<string>) {
  const workspaceRaw = await readFile(path.join(workspaceRoot, 'seevee.json'));
  return JSON.parse(workspaceRaw) as Record<string, unknown>;
}

function resourcesOf(workspace: Record<string, unknown>): Record<string, unknown> {
  const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
  return (data['resources'] as Record<string, unknown> | undefined) ?? {};
}

export const sourcesListTool: ToolDefinition<typeof sourcesListInput, typeof sourcesListOutput> = {
  name: 'sources.list',
  description: 'List source files registered in the workspace.',
  input: sourcesListInput,
  output: sourcesListOutput,
  handler: async (input, ctx) => {
    const workspace = await readWorkspace(input.workspaceRoot, ctx.deps.readFile);
    const resources = resourcesOf(workspace);
    const sources = (resources['sources'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      sources: Object.values(sources).map((entry) => ({
        id: String(entry['id'] ?? ''),
        relativePath: String(entry['relativePath'] ?? ''),
      })),
    };
  },
};

export const sourcesReadExtractTool: ToolDefinition<typeof sourcesReadExtractInput, typeof sourcesReadExtractOutput> = {
  name: 'sources.readExtract',
  description: 'Read an extracted source document for the given source id.',
  input: sourcesReadExtractInput,
  output: sourcesReadExtractOutput,
  handler: async (input, ctx) => {
    const workspace = await readWorkspace(input.workspaceRoot, ctx.deps.readFile);
    const resources = resourcesOf(workspace);
    const sources = (resources['sources'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    const entry = sources[input.sourceId];
    if (!entry) {
      throw new Error(`Source '${input.sourceId}' not registered in workspace`);
    }
    const relativePath = String(entry['relativePath']);
    const absolute = path.join(input.workspaceRoot, relativePath);
    const raw = await ctx.deps.readFile(absolute);
    const document = JSON.parse(raw) as Record<string, unknown>;
    return { document, relativePath };
  },
};

export const sourcesTools = [sourcesListTool, sourcesReadExtractTool] as const;
