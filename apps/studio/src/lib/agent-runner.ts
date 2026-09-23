/**
 * Agent runner stub.
 *
 * Triggers an agent run by recording a started event on the SSE bus and
 * returning a synthesised run ID. The real runner that delegates to
 * `@seevee/agent-runtime` lands in a later milestone; for now the stub
 * lets the dashboard exercise the "Run agent" button without coupling to
 * the runtime.
 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceWatcher } from './watcher.js';

export interface AgentRunRequest {
  workspaceId: string;
  cvId: string;
  prompt: string;
}

export interface AgentRunHandle {
  runId: string;
  startedAt: string;
}

export class AgentRuntimeUnavailableError extends Error {
  readonly code = 'AGENT_RUNTIME_UNAVAILABLE' as const;
  constructor() {
    super('@seevee/agent-runtime is not yet scaffolded — this stub does not execute runs');
    this.name = 'AgentRuntimeUnavailableError';
  }
}

export function startAgentRun(
  _req: AgentRunRequest,
  watcher: WorkspaceWatcher,
): AgentRunHandle {
  const runId = `run_${randomUUID()}`;
  watcher.broadcast({ type: 'agent.run.started', runId });
  // We deliberately do NOT emit agent.run.completed — the real runner
  // owns completion, failure, and cancellation. A short-lived stub that
  // emits a fake completion would mask bugs in the runtime path.
  return { runId, startedAt: new Date().toISOString() };
}