import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Workspace-scoped tools. `workspace.get` reads the workspace document
 * from the canonical `seevee.json` marker and enforces the §4 revision
 * protocol on the document's envelope revision. `workspace.put` and any
 * future mutating tools are intentionally stubbed until the review surface
 * lands.
 */

const workspaceGetInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const workspaceGetOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
    revision: z.number().int().min(0),
  })
  .strict();

const workspacePutInput = z
  .object({
    workspaceRoot: z.string().min(1),
    document: z.record(z.unknown()),
    baseRevision: z.number().int().min(0),
  })
  .strict();

const workspacePutOutput = z
  .object({
    revision: z.number().int().min(0),
  })
  .strict();

const workspaceListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const workspaceListOutput = z
  .object({
    cvs: z.array(z.string()),
    presentations: z.array(z.string()),
    templates: z.array(z.string()),
    sources: z.array(z.string()),
  })
  .strict();

export const workspaceGetTool: ToolDefinition<typeof workspaceGetInput, typeof workspaceGetOutput> = {
  name: 'workspace.get',
  description: 'Read the workspace document from <workspaceRoot>/seevee.json.',
  input: workspaceGetInput,
  output: workspaceGetOutput,
  handler: async (input, ctx) => {
    const relativePath = 'seevee.json';
    const absolute = path.join(input.workspaceRoot, relativePath);
    const raw = await ctx.deps.readFile(absolute);
    const document = JSON.parse(raw) as Record<string, unknown>;
    const revision = Number(document['revision'] ?? 0);
    return { document, relativePath, revision };
  },
};

export const workspacePutTool: ToolDefinition<typeof workspacePutInput, typeof workspacePutOutput> = {
  name: 'workspace.put',
  description: 'Replace the workspace document (mutation — review required).',
  input: workspacePutInput,
  output: workspacePutOutput,
  handler: async () => {
    throw mutationToolError('workspace.put');
  },
};

export const workspaceListTool: ToolDefinition<typeof workspaceListInput, typeof workspaceListOutput> = {
  name: 'workspace.list',
  description: 'List CV/presentation/template/source ids registered in the workspace.',
  input: workspaceListInput,
  output: workspaceListOutput,
  handler: async (input, ctx) => {
    const raw = await ctx.deps.readFile(path.join(input.workspaceRoot, 'seevee.json'));
    const document = JSON.parse(raw) as Record<string, unknown>;
    const data = (document['data'] as Record<string, unknown> | undefined) ?? {};
    const resources = (data['resources'] as Record<string, unknown> | undefined) ?? {};
    const collect = (key: string): string[] => {
      const bucket = resources[key];
      if (!bucket || typeof bucket !== 'object') return [];
      return Object.keys(bucket as Record<string, unknown>);
    };
    return {
      cvs: collect('cvs'),
      presentations: collect('presentations'),
      templates: collect('templates'),
      sources: collect('sources'),
    };
  },
};

export const workspaceTools = [workspaceGetTool, workspacePutTool, workspaceListTool] as const;
