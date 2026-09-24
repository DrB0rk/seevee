import { describe, expect, it } from 'vitest';
import type {
  AdapterApprovalResolution,
  AdapterPromptOptions,
  AdapterSession,
  AgentAdapter,
  CreateAdapterSessionOptions,
} from '../src/control/adapter.js';
import { ompPermissionOptionId } from '../src/adapters/omp.js';
import { JsonRpcProcessClient } from '../src/control/json-rpc.js';
import { seeveeAgentInstructions } from '../src/control/seevee-agent.js';
import { AgentRuntimeManager } from '../src/control/manager.js';
import {
  DEFAULT_AGENT_CAPABILITIES,
  type AgentEvent,
  type AgentPromptResult,
  type AgentProviderDescriptor,
  type AgentSessionConfiguration,
} from '../src/control/types.js';

class FakeSession implements AdapterSession {
  readonly externalSessionId = 'external-test';
  readonly capabilities = DEFAULT_AGENT_CAPABILITIES;
  interrupted = false;
  closed = false;
  approval: AdapterApprovalResolution | null = null;

  constructor(private readonly emit: CreateAdapterSessionOptions['emit']) {}
  configuration: AgentSessionConfiguration = {
    model: 'test-model',
    permissionMode: 'default',
    models: [{ id: 'test-model', label: 'Test model', description: null }],
    permissions: [{ id: 'default', label: 'Ask before tools', description: null }],
  };

  async sendPrompt(options: AdapterPromptOptions): Promise<AgentPromptResult> {
    return { turnId: 'turn-test', queued: false, mode: 'new-turn' };
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  async resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void> {
    this.approval = { ...resolution, optionId: approvalId };
  }

  async updateConfig(options: { model?: string; permissionMode?: string }): Promise<void> {
    if (options.model !== undefined) this.configuration.model = options.model;
    if (options.permissionMode !== undefined) this.configuration.permissionMode = options.permissionMode;
    this.emit({ type: 'session.state', turnId: null, approvalId: null, data: options });
  }

  async getConfiguration(): Promise<AgentSessionConfiguration> {
    return {
      model: this.configuration.model,
      permissionMode: this.configuration.permissionMode,
      models: this.configuration.models,
      permissions: this.configuration.permissions,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}


describe('Seevee workspace agent instructions', () => {
  it('keeps canonical-data and safety rules in the embedded agent file', () => {
    const instructions = seeveeAgentInstructions();
    expect(instructions).toContain('canonical workspace resources');
    expect(instructions).toContain('Never invent factual claims');
    expect(instructions).toContain('Do not claim success');
  });
});
class FakeAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly command = 'fake-codex';
  lastSession: FakeSession | null = null;

  async detect(): Promise<AgentProviderDescriptor> {
    return {
      id: this.id,
      label: 'Fake Codex',
      command: this.command,
      installed: true,
      status: 'ready',
      version: '1.0.0',
      executablePath: '/tmp/fake-codex',
      ready: true,
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      message: null,
    };
  }

  async createSession(options: CreateAdapterSessionOptions): Promise<AdapterSession> {
    this.lastSession = new FakeSession(options.emit);
    return this.lastSession;
  }
}

describe('AgentRuntimeManager', () => {
  it('normalizes provider sessions, prompts, approvals, and shutdown', async () => {
    const events: AgentEvent[] = [];
    const manager = new AgentRuntimeManager((event) => events.push(event));
    const adapter = new FakeAdapter();
    manager.register(adapter);

    const providers = await manager.detectProviders(true);
    expect(providers).toHaveLength(1);
    expect(providers[0]?.ready).toBe(true);

    const session = await manager.createSession({ provider: 'codex' }, '/tmp/workspace');
    expect(session.externalSessionId).toBe('external-test');
    expect(manager.snapshot().sessions).toHaveLength(1);
    const configuration = await manager.getSessionConfiguration(session.id);
    expect(configuration.models[0]?.id).toBe('test-model');
    await manager.updateSession(session.id, { model: 'test-model-next', permissionMode: 'plan' });
    expect(adapter.lastSession?.configuration).toMatchObject({ model: 'test-model-next', permissionMode: 'plan' });

    const result = await manager.sendPrompt(session.id, { text: 'Inspect the workspace', delivery: 'auto' });
    expect(result.turnId).toBe('turn-test');
    expect(manager.snapshot().sessions[0]?.state).toBe('running');

    await manager.resolveApproval(session.id, {
      approvalId: 'approval-1',
      decision: 'allow-once',
    });
    expect(adapter.lastSession?.approval?.optionId).toBe('approval-1');

    await manager.interrupt(session.id);
    expect(adapter.lastSession?.interrupted).toBe(true);

    await manager.closeSession(session.id);
    expect(adapter.lastSession?.closed).toBe(true);
    expect(manager.snapshot().sessions).toHaveLength(0);
    expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.queued')).toHaveLength(0);
  });
});

describe('OMP permission decisions', () => {
  it('uses the option IDs supplied by the active ACP request', () => {
    const params = {
      options: [
        { optionId: 'deny-abc', kind: 'reject_once' },
        { optionId: 'allow-xyz', kind: 'allow_once' },
        { optionId: 'always-999', kind: 'allow_always' },
      ],
    };
    expect(ompPermissionOptionId(params, { decision: 'allow-once' })).toBe('allow-xyz');
    expect(ompPermissionOptionId(params, { decision: 'allow-session' })).toBe('always-999');
    expect(ompPermissionOptionId(params, { decision: 'deny' })).toBe('deny-abc');
  });
});

describe('JsonRpcProcessClient', () => {
  it('correlates requests and notifications over JSONL stdio', async () => {
    const script = `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const message = JSON.parse(line);
        if (message.method === 'notify') {
          process.stdout.write(JSON.stringify({ method: 'ready', params: message.params }) + '\\n');
        } else {
          process.stdout.write(JSON.stringify({ id: message.id, result: { echo: message.params.value } }) + '\\n');
        }
      });
    `;
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
    });
    const notification = new Promise<unknown>((resolve) => {
      client.onNotification = (message) => resolve(message);
    });
    await expect(client.request<{ echo: string }>('ping', { value: 'hello' })).resolves.toEqual({ echo: 'hello' });
    client.notify('notify', { ready: true });
    await expect(notification).resolves.toEqual({ method: 'ready', params: { ready: true } });
    await client.close();
  });
});
