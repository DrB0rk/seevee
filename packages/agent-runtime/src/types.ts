import type { z } from 'zod';
import type { AgentRunDocument, Actor } from '@seevee/schema';

// Re-export so consumers can import agent-run types from this module's surface.
export type { AgentRunDocument, Actor };

/**
 * Public types for the agent-runtime package.
 *
 * The runtime exposes a typed tool boundary and revision-checked executor.
 * Mutating tools are out of scope for this package — they intentionally
 * throw `Error('mutation tool requires review: <name>')` so callers
 * understand they must be wired through a review/approval surface.
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  readonly name: string;
  readonly description?: string;
  readonly input: TInput;
  readonly output: TOutput;
  /**
   * When `true`, runTool enforces the §4 revision protocol: the output's
   * `revision` field (when present) must equal the caller-supplied
   * `baseRevision`. Mismatch returns `{ ok: false, code: 'revision-mismatch' }`.
   * Tools that only read resources should set this; pure functions should not.
   */
  readonly requiresBaseRevision?: boolean;
  readonly handler: (input: z.infer<TInput>, ctx: ToolContext) => Promise<z.infer<TOutput>>;
}

/**
 * Tool registry produced by {@link defineTools}. Maps tool name → definition.
 */
export interface ToolRegistry<TMap extends Record<string, ToolDefinition<any, any>>> {
  readonly definitions: TMap;
  readonly names: ReadonlyArray<keyof TMap & string>;
}

/** Runtime context passed to every tool handler. */
export interface ToolContext {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly deps: RoleDeps;
  /** Caller-supplied base revision for the targeted resource, when applicable. */
  readonly baseRevision?: number;
}

/** Minimal I/O surface the runtime needs to do its work. */
export interface RoleDeps {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly listFiles: (pattern: string) => Promise<string[]>;
  readonly randomId: () => string;
  readonly now: () => Date;
  readonly toolRegistry: ToolRegistry<Record<string, ToolDefinition<any, any>>>;
}

/**
 * Ingestion role input. The shape is intentionally narrow: workspace root,
 * candidate CV id, and the source block ids the role should fold in.
 */
export interface IngestionRoleInput {
  readonly workspaceRoot: string;
  readonly sourceBlockIds: string[];
  readonly candidateCvId: string;
  readonly actor?: Actor;
}

/** Successful execution outcome. */
export interface IngestionRoleSuccess {
  readonly runRecord: AgentRunDocument;
  readonly blockedReason?: undefined;
}

/** Blocked execution outcome — the role refused to proceed without an external decision. */
export interface IngestionRoleBlocked {
  readonly runRecord: AgentRunDocument;
  readonly blockedReason: string;
}

export type IngestionRoleResult = IngestionRoleSuccess | IngestionRoleBlocked;

/** Result envelope for {@link runTool}. */
export type RunToolResult<TOutput> =
  | { readonly ok: true; readonly output: TOutput; readonly runId: string }
  | { readonly ok: false; readonly code: string; readonly error: string };
