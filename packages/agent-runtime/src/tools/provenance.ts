import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Provenance tools. `provenance.get` reads the provenance document linked
 * to a CV; `provenance.assert` is the mutation stub for adding an
 * assertion.
 */

const provenanceGetInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
  })
  .strict();

const provenanceGetOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
  })
  .strict();

const provenanceAssertInput = z
  .object({
    workspaceRoot: z.string().min(1),
    cvId: z.string().min(1),
    assertion: z.record(z.unknown()),
  })
  .strict();

const provenanceAssertOutput = z
  .object({
    assertionId: z.string().min(1),
  })
  .strict();

export const provenanceGetTool: ToolDefinition<typeof provenanceGetInput, typeof provenanceGetOutput> = {
  name: 'provenance.get',
  description: 'Read the provenance document linked to a CV.',
  input: provenanceGetInput,
  output: provenanceGetOutput,
  handler: async (input, ctx) => {
    const workspaceRaw = await ctx.deps.readFile(path.join(input.workspaceRoot, 'seevee.json'));
    const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
    const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
    const resources = (data['resources'] as Record<string, unknown> | undefined) ?? {};
    const provenance = (resources['provenance'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    const candidates = Object.values(provenance).filter((entry) => entry['cvId'] === input.cvId);
    if (candidates.length === 0) {
      throw new Error(`Provenance for CV '${input.cvId}' not registered in workspace`);
    }
    const entry = candidates[0];
    const absolute = path.join(input.workspaceRoot, String(entry['relativePath']));
    const raw = await ctx.deps.readFile(absolute);
    const document = JSON.parse(raw) as Record<string, unknown>;
    return {
      document,
      relativePath: String(entry['relativePath']),
    };
  },
};

export const provenanceAssertTool: ToolDefinition<typeof provenanceAssertInput, typeof provenanceAssertOutput> = {
  name: 'provenance.assert',
  description: 'Add a provenance assertion (mutation — review required).',
  input: provenanceAssertInput,
  output: provenanceAssertOutput,
  handler: async () => {
    throw mutationToolError('provenance.assert');
  },
};

export const provenanceTools = [provenanceGetTool, provenanceAssertTool] as const;
