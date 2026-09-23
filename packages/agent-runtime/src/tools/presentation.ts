import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Presentation tools. `presentation.list` enumerates presentation ids;
 * `presentation.get` reads a single presentation document; the remaining
 * tools are mutation stubs.
 */

const presentationListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const presentationListOutput = z
  .object({
    presentations: z.array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
        templateId: z.string().min(1),
        revision: z.number().int().min(0),
      }),
    ),
  })
  .strict();

const presentationGetInput = z
  .object({
    workspaceRoot: z.string().min(1),
    presentationId: z.string().min(1),
  })
  .strict();

const presentationGetOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
    revision: z.number().int().min(0),
  })
  .strict();

const presentationCreateInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    templateId: z.string().min(1),
    templateVersionId: z.string().min(1),
  })
  .strict();

const presentationCreateOutput = z
  .object({
    presentationId: z.string().min(1),
    relativePath: z.string().min(1),
  })
  .strict();

const presentationProposeChangesInput = z
  .object({
    workspaceRoot: z.string().min(1),
    presentationId: z.string().min(1),
    baseRevision: z.number().int().min(0),
    operations: z.array(z.record(z.unknown())).min(1),
  })
  .strict();

const presentationProposeChangesOutput = z
  .object({
    changeSetId: z.string().min(1),
  })
  .strict();

async function readWorkspaceResources(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const workspaceRaw = await readFile(path.join(workspaceRoot, 'seevee.json'));
  const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
  const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
  return (data['resources'] as Record<string, unknown> | undefined) ?? {};
}

export const presentationListTool: ToolDefinition<typeof presentationListInput, typeof presentationListOutput> = {
  name: 'presentation.list',
  description: 'List presentation documents registered in the workspace.',
  input: presentationListInput,
  output: presentationListOutput,
  handler: async (input, ctx) => {
    const resources = await readWorkspaceResources(input.workspaceRoot, ctx.deps.readFile);
    const presentations = (resources['presentations'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      presentations: Object.values(presentations).map((entry) => ({
        id: String(entry['id'] ?? ''),
        relativePath: String(entry['relativePath'] ?? ''),
        templateId: String(entry['templateId'] ?? ''),
        revision: Number(entry['revision'] ?? 0),
      })),
    };
  },
};

export const presentationGetTool: ToolDefinition<typeof presentationGetInput, typeof presentationGetOutput> = {
  name: 'presentation.get',
  description: 'Read a presentation document by id.',
  input: presentationGetInput,
  output: presentationGetOutput,
  handler: async (input, ctx) => {
    const resources = await readWorkspaceResources(input.workspaceRoot, ctx.deps.readFile);
    const presentations = (resources['presentations'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    const entry = presentations[input.presentationId];
    if (!entry) {
      throw new Error(`Presentation '${input.presentationId}' not registered in workspace`);
    }
    const absolute = path.join(input.workspaceRoot, String(entry['relativePath']));
    const raw = await ctx.deps.readFile(absolute);
    const document = JSON.parse(raw) as Record<string, unknown>;
    return {
      document,
      relativePath: String(entry['relativePath']),
      revision: Number(entry['revision'] ?? 0),
    };
  },
};

export const presentationCreateTool: ToolDefinition<typeof presentationCreateInput, typeof presentationCreateOutput> = {
  name: 'presentation.create',
  description: 'Create a presentation document (mutation — review required).',
  input: presentationCreateInput,
  output: presentationCreateOutput,
  handler: async () => {
    throw mutationToolError('presentation.create');
  },
};

export const presentationProposeChangesTool: ToolDefinition<
  typeof presentationProposeChangesInput,
  typeof presentationProposeChangesOutput
> = {
  name: 'presentation.proposeChanges',
  description: 'Submit a typed change set against a presentation (mutation — review required).',
  input: presentationProposeChangesInput,
  output: presentationProposeChangesOutput,
  handler: async () => {
    throw mutationToolError('presentation.proposeChanges');
  },
};

export const presentationTools = [
  presentationListTool,
  presentationGetTool,
  presentationCreateTool,
  presentationProposeChangesTool,
] as const;
