import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Comments tools. `comments.list` enumerates comment thread ids on a CV;
 * `comments.get` reads a single thread; `comments.setWorkState` is the
 * mutation stub.
 */

const commentsListInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
  })
  .strict();

const commentsListOutput = z
  .object({
    threads: z.array(
      z.object({
        id: z.string().min(1),
        status: z.string(),
      }),
    ),
    relativePath: z.string().min(1),
  })
  .strict();

const commentsGetInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();

const commentsGetOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
  })
  .strict();

const commentsSetWorkStateInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    threadId: z.string().min(1),
    workState: z.string().min(1),
  })
  .strict();

const commentsSetWorkStateOutput = z
  .object({
    accepted: z.boolean(),
  })
  .strict();

async function readCommentsDocument(
  workspaceRoot: string,
  cvId: string,
  readFile: (path: string) => Promise<string>,
): Promise<{ document: Record<string, unknown>; relativePath: string }> {
  const workspaceRaw = await readFile(path.join(workspaceRoot, 'seevee.json'));
  const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
  const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
  const resources = (data['resources'] as Record<string, unknown> | undefined) ?? {};
  const comments = (resources['comments'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  const candidates = Object.values(comments).filter((entry) => entry['cvId'] === cvId);
  if (candidates.length === 0) {
    throw new Error(`Comments for CV '${cvId}' not registered in workspace`);
  }
  const entry = candidates[0];
  const absolute = path.join(workspaceRoot, String(entry['relativePath']));
  const raw = await readFile(absolute);
  const document = JSON.parse(raw) as Record<string, unknown>;
  return { document, relativePath: String(entry['relativePath']) };
}

export const commentsListTool: ToolDefinition<typeof commentsListInput, typeof commentsListOutput> = {
  name: 'comments.list',
  description: 'List comment threads on a CV.',
  input: commentsListInput,
  output: commentsListOutput,
  handler: async (input, ctx) => {
    const { document, relativePath } = await readCommentsDocument(input.workspaceRoot, input.cvId, ctx.deps.readFile);
    const data = (document['data'] as Record<string, unknown> | undefined) ?? {};
    const threads = (data['threads'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      threads: Object.values(threads).map((thread) => ({
        id: String(thread['id'] ?? ''),
        status: String(thread['status'] ?? 'open'),
      })),
      relativePath,
    };
  },
};

export const commentsGetTool: ToolDefinition<typeof commentsGetInput, typeof commentsGetOutput> = {
  name: 'comments.get',
  description: 'Read a single comment thread.',
  input: commentsGetInput,
  output: commentsGetOutput,
  handler: async (input, ctx) => {
    const { document, relativePath } = await readCommentsDocument(input.workspaceRoot, input.cvId, ctx.deps.readFile);
    return { document, relativePath };
  },
};

export const commentsSetWorkStateTool: ToolDefinition<
  typeof commentsSetWorkStateInput,
  typeof commentsSetWorkStateOutput
> = {
  name: 'comments.setWorkState',
  description: 'Mark a comment thread as the agent\u2019s work state (mutation — review required).',
  input: commentsSetWorkStateInput,
  output: commentsSetWorkStateOutput,
  handler: async () => {
    throw mutationToolError('comments.setWorkState');
  },
};

export const commentsTools = [commentsListTool, commentsGetTool, commentsSetWorkStateTool] as const;
