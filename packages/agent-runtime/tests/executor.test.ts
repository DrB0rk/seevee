import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineTools,
  runTool,
  RevisionMismatchError,
  ToolNotFoundError,
  FactPolicyError,
} from '../src/executor.js';
import type { RoleDeps, ToolDefinition, ToolRegistry } from '../src/types.js';

function makeDeps(): RoleDeps {
  return {
    readFile: async () => '',
    writeFile: async () => undefined,
    listFiles: async () => [],
    randomId: () => 'run_test_001',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    toolRegistry: defineTools({}),
  };
}

type AnyRegistry = ToolRegistry<Record<string, ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>>>;

function emptyRegistry(): AnyRegistry {
  return defineTools({});
}

function registryWith(tool: ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>): AnyRegistry {
  return defineTools({ [tool.name]: tool });
}

const echoInput = z.object({ value: z.string() }).strict();
const echoOutput = z.object({ echoed: z.string() }).strict();
const echoTool: ToolDefinition<typeof echoInput, typeof echoOutput> = {
  name: 'echo',
  input: echoInput,
  output: echoOutput,
  handler: async (input: z.infer<typeof echoInput>) => ({ echoed: input.value }),
};
const echoToolAny: ToolDefinition<z.ZodTypeAny, z.ZodTypeAny> = echoTool as unknown as ToolDefinition<
  z.ZodTypeAny,
  z.ZodTypeAny
>;

const revisionedInput = z.object({}).strict();
const revisionedOutput = z.object({ revision: z.number().int().min(0) }).strict();
const revisionedTool: ToolDefinition<typeof revisionedInput, typeof revisionedOutput> = {
  name: 'revisioned',
  input: revisionedInput,
  output: revisionedOutput,
  requiresBaseRevision: true,
  handler: async () => ({ revision: 7 }),
};
const revisionedToolAny: ToolDefinition<z.ZodTypeAny, z.ZodTypeAny> = revisionedTool as unknown as ToolDefinition<
  z.ZodTypeAny,
  z.ZodTypeAny
>;

describe('defineTools', () => {
  test('returns a frozen registry with the supplied definitions', () => {
    const registry = emptyRegistry();
    expect(Object.keys(registry.definitions)).toEqual([]);
    expect(Object.isFrozen(registry.definitions)).toBe(true);
    expect(Object.isFrozen(registry.names)).toBe(true);
  });
});

describe('runTool', () => {
  test('invokes handler and returns parsed output on success', async () => {
    const registry = registryWith(echoToolAny);
    const result = await runTool(
      registry,
      'echo',
      { value: 'hi' },
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.echoed).toBe('hi');
      expect(result.runId).toBe('run_test');
    }
  });

  test('returns tool-not-found envelope for unknown tools', async () => {
    const registry = registryWith(echoToolAny);
    const result = await runTool(
      registry,
      'missing',
      { value: 'hi' },
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('tool-not-found');
      expect(result.error).toMatch(/missing/);
    }
    const err = new ToolNotFoundError('boom');
    expect(err.code).toBe('tool-not-found');
    expect(err.name).toBe('ToolNotFoundError');
  });

  test('returns invalid-input envelope for malformed input', async () => {
    const registry = registryWith(echoToolAny);
    const result = await runTool(
      registry,
      'echo',
      // Missing required `value`.
      { wrong: 'shape' },
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-input');
      expect(result.error).toMatch(/value/);
    }
  });

  test('returns revision-mismatch envelope when baseRevision disagrees with the resource', async () => {
    const registry = registryWith(revisionedToolAny);
    const result = await runTool(
      registry,
      'revisioned',
      {},
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test', baseRevision: 99 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('revision-mismatch');
      expect(result.error).toMatch(/baseRevision 99/);
    }
    const err = new RevisionMismatchError('mismatch');
    expect(err.code).toBe('revision-mismatch');
    expect(err.name).toBe('RevisionMismatchError');
  });

  test('accepts matching baseRevision for revision-checked tools', async () => {
    const registry = registryWith(revisionedToolAny);
    const result = await runTool(
      registry,
      'revisioned',
      {},
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test', baseRevision: 7 },
    );
    expect(result.ok).toBe(true);
  });

  test('returns invalid-input when a revision-checked tool is called without baseRevision', async () => {
    const registry = registryWith(revisionedToolAny);
    const result = await runTool(
      registry,
      'revisioned',
      {},
      { deps: makeDeps(), workspaceRoot: '/tmp', runId: 'run_test' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid-input');
    }
  });
});

describe('fact-policy guard', () => {
  test('FactPolicyError is exported with a stable code', () => {
    const err = new FactPolicyError('cannot fabricate dates');
    expect(err.code).toBe('fact-policy');
    expect(err.name).toBe('FactPolicyError');
  });
});
