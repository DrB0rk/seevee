import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@seevee/agent-runtime';

import { buildTimeline, TimelineItemView } from '../src/components/agent/AgentChat.js';

/**
 * These assert rendered markup, not the data model. A timeline test cannot
 * tell whether a failure renders inside the collapsed disclosure or beside
 * it, and that difference is the whole point: beside it floods the panel.
 */
function event(seq: number, type: AgentEvent['type'], data: Record<string, unknown>): AgentEvent {
  return {
    schema: 'seevee.agent-event.v1',
    seq,
    type,
    provider: 'codex',
    sessionId: 's1',
    turnId: 't1',
    approvalId: null,
    occurredAt: `2026-09-25T10:00:${String(seq).padStart(2, '0')}.000Z`,
    data,
  };
}

function renderRow(events: AgentEvent[]): string {
  const item = buildTimeline(events)[0];
  if (item === undefined) throw new Error('expected a timeline item');
  return renderToStaticMarkup(
    <TimelineItemView
      item={item}
      last
      busy={false}
      providerLabel="Codex"
      elicitationValue=""
      onApproval={async () => {}}
      onElicitationChange={() => {}}
    />,
  );
}

const failedCommand: AgentEvent[] = [
  event(1, 'tool.started', { callId: 'c1', name: 'commandExecution', status: 'inProgress', input: 'pnpm test' }),
  event(2, 'tool.completed', { callId: 'c1', name: 'commandExecution', status: 'failed', input: 'pnpm test', output: 'SyntaxError: unexpected token' }),
];

describe('agent chat row markup', () => {
  it('renders a command row collapsed with no open attribute', () => {
    const markup = renderRow(failedCommand);
    expect(markup).toContain('class="agent-activity-collapse"');
    expect(markup).not.toMatch(/<details[^>]*class="agent-activity-collapse"[^>]*\sopen/);
  });

  it('renders the failure inside the disclosure, not beside it', () => {
    const markup = renderRow(failedCommand);
    const open = markup.indexOf('<details class="agent-activity-collapse">');
    const close = markup.lastIndexOf('</details>');
    const failure = markup.indexOf('agent-activity-failure');
    expect(open).toBeGreaterThan(-1);
    expect(failure).toBeGreaterThan(open);
    expect(failure).toBeLessThan(close);
  });

  it('shows the failing command and its error once expanded', () => {
    const markup = renderRow(failedCommand);
    expect(markup).toContain('pnpm test');
    expect(markup).toContain('SyntaxError: unexpected token');
  });

  it('keeps the failure count in the collapsed title', () => {
    expect(renderRow(failedCommand)).toContain('Ran 1 command · 1 failed');
  });

  it('renders an error card collapsed with its message as the summary', () => {
    const markup = renderRow([event(1, 'turn.failed', { message: 'The run could not complete' })]);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
    expect(markup).toContain('The run could not complete');
  });
});
