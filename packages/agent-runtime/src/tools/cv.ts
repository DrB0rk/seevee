import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * CV tools — `cv.list` enumerates CV ids in the workspace;
 * `cv.get` reads a single CV document and enforces the §4 revision
 * protocol; `cv.create` / `cv.duplicate` / `cv.proposeChanges` are
 * mutation stubs awaiting the review surface.
 */

const cvListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const cvListOutput = z
  .object({
    cvs: z.array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
        revision: z.number().int().min(0),
      }),
    ),
  })
  .strict();

const cvGetInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
  })
  .strict();

const cvGetOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
    revision: z.number().int().min(0),
  })
  .strict();

const cvCreateInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    seed: z.record(z.unknown()).optional(),
  })
  .strict();

const cvCreateOutput = z
  .object({
    cvId: z.string().min(1),
    relativePath: z.string().min(1),
  })
  .strict();

const cvDuplicateInput = cvCreateInput.extend({
  sourceCvId: z.string().min(1),
});

const cvDuplicateOutput = cvCreateOutput;

const cvProposeChangesInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    baseRevision: z.number().int().min(0),
    operations: z.array(z.record(z.unknown())).min(1),
  })
  .strict();

const cvProposeChangesOutput = z
  .object({
    changeSetId: z.string().min(1),
  })
  .strict();

export const cvListTool: ToolDefinition<typeof cvListInput, typeof cvListOutput> = {
  name: 'cv.list',
  description: 'List CVs registered in the workspace manifest.',
  input: cvListInput,
  output: cvListOutput,
  handler: async (input, ctx) => {
    const workspaceRaw = await ctx.deps.readFile(path.join(input.workspaceRoot, 'seevee.json'));
    const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
    const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
    const resources = (data['resources'] as Record<string, unknown> | undefined) ?? {};
    const cvs = (resources['cvs'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      cvs: Object.values(cvs).map((entry) => ({
        id: String(entry['id'] ?? ''),
        relativePath: String(entry['relativePath'] ?? ''),
        revision: Number(entry['revision'] ?? 0),
      })),
    };
  },
};

export const cvGetTool: ToolDefinition<typeof cvGetInput, typeof cvGetOutput> = {
  name: 'cv.get',
  description: 'Read a CV document by id.',
  input: cvGetInput,
  output: cvGetOutput,
  handler: async (input, ctx) => {
    const workspaceRaw = await ctx.deps.readFile(path.join(input.workspaceRoot, 'seevee.json'));
    const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
    const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
    const resources = (data['resources'] as Record<string, unknown> | undefined) ?? {};
    const cvs = (resources['cvs'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    const entry = cvs[input.cvId];
    if (!entry) {
      throw new Error(`CV '${input.cvId}' not registered in workspace`);
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

export const cvCreateTool: ToolDefinition<typeof cvCreateInput, typeof cvCreateOutput> = {
  name: 'cv.create',
  description: 'Create a new CV document (mutation — review required).',
  input: cvCreateInput,
  output: cvCreateOutput,
  handler: async () => {
    throw mutationToolError('cv.create');
  },
};

export const cvDuplicateTool: ToolDefinition<typeof cvDuplicateInput, typeof cvDuplicateOutput> = {
  name: 'cv.duplicate',
  description: 'Duplicate a CV (mutation — review required).',
  input: cvDuplicateInput,
  output: cvDuplicateOutput,
  handler: async () => {
    throw mutationToolError('cv.duplicate');
  },
};

export const cvProposeChangesTool: ToolDefinition<typeof cvProposeChangesInput, typeof cvProposeChangesOutput> = {
  name: 'cv.proposeChanges',
  description: 'Submit a typed change set against a CV (mutation — review required).',
  input: cvProposeChangesInput,
  output: cvProposeChangesOutput,
  handler: async () => {
    throw mutationToolError('cv.proposeChanges');
  },
};

export const cvTools = [
  cvListTool,
  cvGetTool,
  cvCreateTool,
  cvDuplicateTool,
  cvProposeChangesTool,
] as const;
