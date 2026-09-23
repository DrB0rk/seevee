import { z } from 'zod';
import path from 'node:path';
import type { ToolDefinition } from '../types.js';

/**
 * History tools. `history.list` enumerates persisted agent run documents
 * at `<workspaceRoot>/.seevee/history/<runId>.json`.
 */

const historyListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const historyListOutput = z
  .object({
    runs: z.array(
      z.object({
        id: z.string().min(1),
        type: z.string(),
        state: z.string(),
        summary: z.string(),
        completedAt: z.string().nullable(),
      }),
    ),
  })
  .strict();

export const historyListTool: ToolDefinition<typeof historyListInput, typeof historyListOutput> = {
  name: 'history.list',
  description: 'List previously persisted agent run documents for the workspace.',
  input: historyListInput,
  output: historyListOutput,
  handler: async (input, ctx) => {
    const historyDir = path.join(input.workspaceRoot, '.seevee', 'history');
    const matches = await ctx.deps.listFiles(path.join(historyDir, '*.json'));
    const runs: Array<{
      id: string;
      type: string;
      state: string;
      summary: string;
      completedAt: string | null;
    }> = [];
    for (const match of matches) {
      try {
        const raw = await ctx.deps.readFile(match);
        const document = JSON.parse(raw) as Record<string, unknown>;
        runs.push({
          id: String(document['id'] ?? path.basename(match, '.json')),
          type: String(document['type'] ?? 'unknown'),
          state: String(document['state'] ?? 'unknown'),
          summary: String(document['summary'] ?? ''),
          completedAt: (document['completedAt'] as string | null) ?? null,
        });
      } catch {
        // Skip unreadable entries; the dashboard will surface corrupt history.
      }
    }
    return { runs };
  },
};

export const historyTools = [historyListTool] as const;
