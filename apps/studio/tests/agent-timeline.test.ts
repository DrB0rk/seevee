import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@seevee/agent-runtime';
import { buildTimeline, summarizeAgentEvents } from '../src/components/agent/AgentChat.js';

function event(
  seq: number,
  type: AgentEvent['type'],
  data: Record<string, unknown>,
  options: { turnId?: string | null; approvalId?: string | null } = {},
): AgentEvent {
  return {
    schema: 'seevee.agent-event.v1',
    seq,
    type,
    provider: 'omp',
    sessionId: 'agent-test',
    turnId: options.turnId === undefined ? 'turn-1' : options.turnId,
    approvalId: options.approvalId ?? null,
    occurredAt: `2026-09-24T21:00:${String(seq).padStart(2, '0')}.000Z`,
    data,
  };
}

describe('agent timeline normalization', () => {
  it('keeps final responses after tools and preserves failures', () => {
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
    expect(timeline.map((item) => item.kind)).toEqual(['reasoning', 'tool', 'approval', 'assistant']);
    expect(timeline.find((item) => item.kind === 'reasoning')?.status).toBe('completed');
    expect(timeline.some((item) => item.kind === 'status' || item.kind === 'usage')).toBe(false);

    const summary = summarizeAgentEvents(events, 'completed');
    expect(summary.phase).toBe('failed');
    expect(summary.label).toBe('Tool failed: edit');
    expect(summary.usage).toContain('100 / 1,000');
  });
});
