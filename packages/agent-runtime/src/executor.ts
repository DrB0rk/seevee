import { z } from 'zod';
import type {
  ToolDefinition,
  ToolRegistry,
  ToolContext,
  RunToolResult,
  RoleDeps,
} from './types.js';

/**
 * Error class surfaced for §4 revision-mismatch conditions.
 */
export class RevisionMismatchError extends Error {
  public override readonly name = 'RevisionMismatchError';
  public readonly code = 'revision-mismatch';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Error class surfaced when a tool name is not present in the registry.
 */
export class ToolNotFoundError extends Error {
  public override readonly name = 'ToolNotFoundError';
  public readonly code = 'tool-not-found';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Error class surfaced when the agent attempts to fabricate a fact (§5 fact policy).
 */
export class FactPolicyError extends Error {
  public override readonly name = 'FactPolicyError';
  public readonly code = 'fact-policy';
  constructor(message: string) {
    super(message);
  }
}

export type AnyToolRegistry = ToolRegistry<Record<string, ToolDefinition<any, any>>>;

/** Build a typed tool registry from a map of definitions. */
export function defineTools<TMap extends Record<string, ToolDefinition<any, any>>>(
  defs: TMap,
): ToolRegistry<TMap> {
  const names = Object.keys(defs) as Array<keyof TMap & string>;
  return Object.freeze({
    definitions: Object.freeze(defs) as TMap,
    names: Object.freeze(names),
  });
}

interface RunToolOptions {
  readonly deps: RoleDeps;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly baseRevision?: number;
}

export async function runTool<
  TMap extends Record<string, ToolDefinition<any, any>>,
  TName extends keyof TMap & string,
>(
  registry: ToolRegistry<TMap>,
  name: TName,
  input: unknown,
  options: RunToolOptions,
): Promise<RunToolResult<z.infer<TMap[TName]['output']>>> {
  const def = registry.definitions[name] as ToolDefinition<any, any> | undefined;
  if (!def) {
    return {
      ok: false,
      code: 'tool-not-found',
      error: `Tool '${name}' is not registered`,
    };
  }
  const parsed = def.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid-input',
      error: parsed.error.issues
        .map((issue: z.ZodIssue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    };
  }
  if (def.requiresBaseRevision && options.baseRevision === undefined) {
    return {
      ok: false,
      code: 'invalid-input',
      error: `tool '${name}' requires a baseRevision in runTool options`,
    };
  }
  const toolCtx: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    runId: options.runId,
    deps: options.deps,
    baseRevision: options.baseRevision,
  };
  let output: unknown;
  try {
    output = await def.handler(parsed.data, toolCtx);
  } catch (err) {
    // MutationToolError — let it propagate so callers can use .rejects.toThrow()
    if (err instanceof Error && err.message.startsWith('mutation tool requires review')) throw err;
    return {
      ok: false,
      code: 'handler-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (def.requiresBaseRevision) {
    const outputRevision = (output as { revision?: unknown } | null | undefined)?.revision;
    if (typeof outputRevision !== 'number') {
      return {
        ok: false,
        code: 'invalid-input',
        error: `tool '${name}' requires its output to expose a numeric 'revision' field`,
      };
    }
    if (outputRevision !== options.baseRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        error: `baseRevision ${options.baseRevision} does not match resource revision ${outputRevision} for tool '${name}'`,
      };
    }
  }
  return { ok: true, output, runId: options.runId };
}

/** Build a stub error message for mutation tools. */
export function mutationToolError(name: string): Error {
  return new Error(`mutation tool requires review: ${name}`);
}
