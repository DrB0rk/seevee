import {
  AgentRuntimeManager,
  createDefaultAgentAdapters,
  type AgentEvent,
} from '@seevee/agent-runtime';
import { persistAgentSession } from './agent-session-index.js';
import { validateAgentWorkspace } from './agent-validation.js';
import { workspaceWatcher } from './runtime.js';
import { loadWorkspaceContext } from './workspace.js';

interface AgentRuntimeSlot {
  manager: AgentRuntimeManager | null;
  initPromise: Promise<AgentRuntimeManager> | null;
  shutdownRegistered: boolean;
}

const AGENT_RUNTIME_KEY = Symbol.for('@seevee/studio/agent-runtime-slot');

type GlobalWithAgentRuntime = typeof globalThis & {
  [AGENT_RUNTIME_KEY]?: AgentRuntimeSlot;
};

function agentRuntimeSlot(): AgentRuntimeSlot {
  const global = globalThis as GlobalWithAgentRuntime;
  if (global[AGENT_RUNTIME_KEY] === undefined) {
    global[AGENT_RUNTIME_KEY] = {
      manager: null,
      initPromise: null,
      shutdownRegistered: false,
    };
  }
  return global[AGENT_RUNTIME_KEY];
}
const sessionPersistTimers = new Map<string, NodeJS.Timeout>();

function scheduleSessionPersist(manager: AgentRuntimeManager, sessionId: string, workspaceRoot: string): void {
  clearTimeout(sessionPersistTimers.get(sessionId));
  const timer = setTimeout(() => {
    sessionPersistTimers.delete(sessionId);
    const session = manager.snapshot().sessions.find((item) => item.id === sessionId);
    if (session !== undefined) void persistAgentSession(workspaceRoot, session);
  }, 500);
  timer.unref?.();
  sessionPersistTimers.set(sessionId, timer);
}


async function validateAfterTurn(manager: AgentRuntimeManager, sessionId: string, workspaceRoot: string): Promise<void> {
  manager.emitSessionEvent(sessionId, 'validation.started', { startedAt: new Date().toISOString() });
  try {
    const result = await validateAgentWorkspace(workspaceRoot);
    manager.emitSessionEvent(sessionId, 'validation.completed', result);
  } catch (error) {
    manager.emitSessionEvent(sessionId, 'validation.completed', {
      status: 'failed',
      checked: 0,
      failures: [{ resource: 'workspace', reason: error instanceof Error ? error.message : String(error) }],
      warnings: [],
    });
  }
}

export async function agentRuntimeManager(): Promise<AgentRuntimeManager> {
  const slot = agentRuntimeSlot();
  if (slot.manager !== null) return slot.manager;
  if (slot.initPromise === null) {
    slot.initPromise = (async () => {
      const [context, watcher] = await Promise.all([
        loadWorkspaceContext(),
        workspaceWatcher(),
      ]);
      let manager: AgentRuntimeManager;
      manager = new AgentRuntimeManager((event: AgentEvent) => {
        watcher.broadcast({ type: 'agent.event', event });
        if (event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.cancelled') {
          scheduleSessionPersist(manager, event.sessionId, context.root);
        }
        if (event.type === 'turn.completed') {
          void validateAfterTurn(manager, event.sessionId, context.root);
        }
      });
      for (const adapter of createDefaultAgentAdapters()) manager.register(adapter);
      watcher.subscribe((event) => {
        if (event.type === 'agent.event') return;
        const activeSession = manager.snapshot().sessions.find((session) =>
          session.state === 'running' || session.state === 'waiting-approval');
        if (activeSession === undefined) return;
        manager.emitSessionEvent(activeSession.id, 'workspace.changed', {
          eventType: event.type,
          resource: 'path' in event ? event.path : null,
        });
      });
      await manager.detectProviders(true);
      slot.manager = manager;
      if (!slot.shutdownRegistered) {
        slot.shutdownRegistered = true;
        let shutdownStarted = false;
        const shutdown = async (): Promise<void> => {
          if (shutdownStarted) return;
          shutdownStarted = true;
          await manager.shutdown();
        };
        process.once('beforeExit', () => void shutdown());
        process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
        process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
      }
      return manager;
    })();
  }
  return slot.initPromise;
}
