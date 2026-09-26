import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@seevee/agent-runtime';
import { buildChatStream, buildTimeline, summarizeAgentEvents } from '../src/components/agent/AgentChat.js';

function event(
  seq: number,
  type: AgentEvent['type'],
  data: Record<string, unknown>,
  options: { turnId?: string | null; approvalId?: string | null; provider?: AgentEvent['provider'] } = {},
): AgentEvent {
  return {
    schema: 'seevee.agent-event.v1',
    seq,
    type,
    provider: options.provider ?? 'omp',
    sessionId: 'agent-test',
    turnId: options.turnId === undefined ? 'turn-1' : options.turnId,
    approvalId: options.approvalId ?? null,
    occurredAt: `2026-09-24T21:00:${String(seq).padStart(2, '0')}.000Z`,
    data,
  };
}

describe('agent timeline normalization', () => {
  it('renders the same message and tool lifecycle for every provider', () => {
    const providers: AgentEvent['provider'][] = ['omp', 'codex', 'claude-code'];
    const makeEvents = (provider: AgentEvent['provider']): AgentEvent[] => {
      const events: AgentEvent[] = [];
      let seq = 1;
      const add = (type: AgentEvent['type'], data: Record<string, unknown>) => events.push(event(seq++, type, data, { provider }));
      if (provider === 'omp') add('message.started', { role: 'user', content: "The user's own prompt." });
      if (provider === 'claude-code') add('message.started', { role: 'assistant', text: '' });
      add('message.delta', { delta: 'First response.' });
      if (provider === 'claude-code') add('message.completed', { text: 'First response.' });
      add('tool.started', { callId: 'tool-1', name: 'readFile', status: provider === 'omp' ? 'pending' : provider === 'codex' ? 'in_progress' : 'running' });
      if (provider === 'claude-code') add('message.started', { role: 'assistant', text: '' });
      add('message.delta', { delta: 'Final response.' });
      if (provider === 'claude-code') add('message.completed', { text: 'Final response.' });
      add('turn.completed', {});
      return events;
    };

    for (const provider of providers) {
      const timeline = buildTimeline(makeEvents(provider));
      expect(timeline.map((item) => item.kind), provider).toEqual(['assistant', 'tool', 'assistant']);
      expect(timeline.filter((item) => item.kind === 'assistant').map((item) => item.text), provider)
        .toEqual(['First response.', 'Final response.']);
      expect(timeline.filter((item) => item.kind === 'tool').map((item) => item.status), provider).toEqual(['completed']);
    }
  });

  it('keeps the transcript in strict emission order and preserves failures', () => {
    const events: AgentEvent[] = [
      event(1, 'turn.started', {}),
      event(2, 'reasoning.delta', { delta: 'Checking the requested field.' }),
      event(3, 'message.started', { text: '' }),
      event(4, 'message.delta', { delta: 'I could not make the edit.' }),
      event(5, 'message.completed', { text: 'I could not make the edit.' }),
      event(6, 'tool.started', { callId: 'call-edit', name: 'edit', status: 'running' }),
      event(7, 'tool.completed', { callId: 'call-edit', name: 'edit', status: 'failed' }),
      event(8, 'approval.requested', { title: 'Allow edit' }, { approvalId: 'approval-1' }),
      event(9, 'approval.resolved', { decision: 'allow-once' }, { approvalId: 'approval-1' }),
      event(10, 'validation.started', {}),
      event(11, 'validation.completed', { status: 'passed', checked: 4 }),
      event(12, 'usage.updated', { totalTokens: 100, contextWindow: 1000, outputTokens: 12 }),
      event(13, 'turn.completed', {}),
    ];

    const timeline = buildTimeline(events);
    // A message that streams before later tool activity stays where it was
    // emitted. Moving it would reshuffle a transcript the user is reading.
    expect(timeline.map((item) => item.kind)).toEqual(['reasoning', 'assistant', 'tool', 'approval']);
    expect(timeline.map((item) => item.seq)).toEqual([2, 3, 6, 8]);
    expect(timeline.find((item) => item.kind === 'reasoning')?.status).toBe('completed');
    expect(timeline.some((item) => item.kind === 'status' || item.kind === 'usage')).toBe(false);

    const summary = summarizeAgentEvents(events, 'completed');
    expect(summary.phase).toBe('failed');
    expect(summary.label).toBe('Could not update file');
    expect(summary.usage).toContain('100 / 1,000');
  });

  it('never reorders completed items when a later turn produces more activity', () => {
    const events: AgentEvent[] = [
      event(1, 'message.started', { text: '' }),
      event(2, 'message.delta', { delta: 'First answer.' }),
      event(3, 'message.completed', { text: 'First answer.' }),
      event(4, 'tool.started', { callId: 'call-1', name: 'edit', status: 'running' }),
      event(5, 'tool.completed', { callId: 'call-1', name: 'edit', status: 'completed' }),
      event(6, 'message.started', { text: '' }),
      event(7, 'message.delta', { delta: 'Second answer.' }),
      event(8, 'message.completed', { text: 'Second answer.' }),
    ];

    const timeline = buildTimeline(events);
    expect(timeline.map((item) => `${item.kind}:${item.seq}`)).toEqual(['assistant:1', 'tool:4', 'assistant:6']);
  });

  it('orders user prompts chronologically among agent activity', () => {
    const timeline = buildTimeline([
      event(1, 'turn.started', {}),
      event(2, 'tool.started', { callId: 'call-1', name: 'readFile', status: 'running' }),
      event(3, 'message.delta', { delta: 'Done.' }),
    ]);
    const prompts = [
      { id: 'p1', sessionId: 'agent-test', text: 'first ask', createdAt: '2026-09-24T20:59:00.000Z' },
      { id: 'p2', sessionId: 'agent-test', text: 'second ask', createdAt: '2026-09-24T21:00:02.500Z' },
    ];

    const stream = buildChatStream(timeline, prompts);
    expect(stream.map((entry) => entry.kind === 'prompt' ? `prompt:${entry.prompt.id}` : `item:${entry.item.seq}`)).toEqual([
      'prompt:p1',
      'item:2',
      'prompt:p2',
      'item:3',
    ]);
  });

  it('sorts a prompt before the run it triggered at the same millisecond', () => {
    const timeline = buildTimeline([event(1, 'message.delta', { delta: 'Working on it.' })]);
    const stream = buildChatStream(timeline, [
      { id: 'p1', sessionId: 'agent-test', text: 'go', createdAt: '2026-09-24T21:00:01.000Z' },
    ]);
    expect(stream.map((entry) => entry.kind)).toEqual(['prompt', 'item']);
  });

  it('groups repeated tool activity into readable summaries', () => {
    const events: AgentEvent[] = [
      event(1, 'tool.started', { callId: 'command-1', name: 'commandExecution', status: 'running' }),
      event(2, 'tool.completed', { callId: 'command-1', name: 'commandExecution', status: 'completed' }),
      event(3, 'tool.started', { callId: 'command-2', name: 'commandExecution', status: 'running' }),
      event(4, 'tool.completed', { callId: 'command-2', name: 'commandExecution', status: 'completed' }),
      event(5, 'tool.started', { callId: 'read-1', name: 'readFile', status: 'running' }),
      event(6, 'tool.completed', { callId: 'read-1', name: 'readFile', status: 'completed' }),
    ];
    const timeline = buildTimeline(events);
    expect(timeline.filter((item) => item.kind === 'tool').map((item) => item.title)).toEqual([
      'Ran 2 commands',
      'Read 1 file',
    ]);
  });

  it('uses a human-readable running label for active grouped activity', () => {
    const events: AgentEvent[] = [
      event(1, 'turn.started', {}),
      event(2, 'tool.started', { callId: 'read-1', name: 'readFile', status: 'running', input: { path: '/root/seevee.json' } }),
      event(3, 'tool.started', { callId: 'read-2', name: 'readFile', status: 'running', input: { path: '/root/cvs/cv.json' } }),
    ];
    expect(buildTimeline(events).find((item) => item.kind === 'tool')?.title).toBe('Reading 2 files');
    const summary = summarizeAgentEvents(events, 'running', Date.parse('2026-09-24T21:00:10.000Z'));
    expect(summary.label).toBe('Reading 2 files');
    // The status line names the kind of work, never the raw path.
    expect(summary.detail).toBe('reading a file');
    expect(summary.elapsed).toBe('9s');
  });

  it('keeps the failing call visible inside a collapsed command group', () => {
    const events: AgentEvent[] = [
      event(1, 'tool.started', { callId: 'c1', name: 'commandExecution', status: 'inProgress', input: 'pnpm test' }),
      event(2, 'tool.completed', { callId: 'c1', name: 'commandExecution', status: 'completed', output: 'all good' }),
      event(3, 'tool.started', { callId: 'c2', name: 'commandExecution', status: 'inProgress', input: 'pnpm lint' }),
      event(4, 'tool.completed', { callId: 'c2', name: 'commandExecution', status: 'failed', input: 'pnpm lint', output: 'SyntaxError: unexpected token' }),
      event(5, 'tool.started', { callId: 'c3', name: 'commandExecution', status: 'inProgress', input: 'pnpm build' }),
      event(6, 'tool.completed', { callId: 'c3', name: 'commandExecution', status: 'completed', output: 'built' }),
    ];
    const group = buildTimeline(events).find((item) => item.kind === 'tool');
    expect(group?.title).toBe('Ran 3 commands · 1 failed');
    expect(group?.status).toBe('failed');
    expect(group?.failures).toEqual([{ input: 'pnpm lint', output: 'SyntaxError: unexpected token' }]);
  });

  it('treats the ACP inProgress status as running rather than settled', () => {
    const events: AgentEvent[] = [
      event(1, 'tool.started', { callId: 'c1', name: 'commandExecution', status: 'inProgress' }),
      event(2, 'tool.started', { callId: 'c2', name: 'commandExecution', status: 'inProgress' }),
    ];
    expect(buildTimeline(events).find((item) => item.kind === 'tool')?.title).toBe('Running 2 commands');
  });

  it('omits empty reasoning frames from the transcript', () => {
    const events: AgentEvent[] = [
      event(1, 'reasoning.delta', { id: 'rs_1', text: [] }),
      event(2, 'reasoning.delta', { id: 'rs_1', text: [] }),
      event(3, 'message.delta', { delta: 'Done.' }),
    ];
    const timeline = buildTimeline(events);
    expect(timeline.find((item) => item.kind === 'reasoning')).toBeUndefined();
    expect(timeline.find((item) => item.kind === 'assistant')?.text).toBe('Done.');
  });

  it('reads reasoning text from ACP content blocks', () => {
    const events: AgentEvent[] = [
      event(1, 'reasoning.delta', { id: 'rs_1', text: [{ type: 'text', text: 'Checking the manifest.' }] }),
    ];
    expect(buildTimeline(events)[0]?.text).toBe('Checking the manifest.');
  });

  it('does not report a clean run when earlier tool calls failed', () => {
    const events: AgentEvent[] = [
      event(1, 'turn.started', {}),
      event(2, 'tool.started', { callId: 'c1', name: 'commandExecution', status: 'inProgress' }),
      event(3, 'tool.completed', { callId: 'c1', name: 'commandExecution', status: 'failed', output: 'boom' }),
      event(4, 'turn.completed', {}),
      event(5, 'turn.started', {}, { turnId: 'turn-2' }),
      event(6, 'message.completed', { text: 'Recovered.' }),
      event(7, 'turn.completed', {}, { turnId: 'turn-2' }),
      event(8, 'validation.completed', { status: 'passed' }),
    ];
    const summary = summarizeAgentEvents(events, 'completed');
    expect(summary.phase).toBe('completed');
    expect(summary.detail).toBe('1 tool call failed — open the activity to see why');
  });

  it('keeps the completed state when workspace validation events arrive afterward', () => {
    const events: AgentEvent[] = [
      event(1, 'turn.started', {}),
      event(2, 'message.completed', { text: 'The task is complete.' }),
      event(3, 'turn.completed', {}),
      event(4, 'validation.started', {}),
      event(5, 'validation.completed', { status: 'passed', checked: 5 }),
    ];
    const summary = summarizeAgentEvents(events, 'completed');
    expect(summary.phase).toBe('completed');
    expect(summary.label).toBe('Completed · workspace valid');
    expect(summary.detail).toBe('Workspace changes are valid.');
  });
});
