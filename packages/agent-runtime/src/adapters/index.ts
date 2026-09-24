import type { AgentAdapter } from '../control/adapter.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { OmpAdapter } from './omp.js';

export function createDefaultAgentAdapters(): AgentAdapter[] {
  return [new ClaudeCodeAdapter(), new CodexAdapter(), new OmpAdapter()];
}

export { ClaudeCodeAdapter } from './claude-code.js';
export { CodexAdapter } from './codex.js';
export { OmpAdapter } from './omp.js';
