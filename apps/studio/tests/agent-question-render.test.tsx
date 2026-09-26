import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@seevee/agent-runtime';

import { buildTimeline, TimelineItemView } from '../src/components/agent/AgentChat.js';

function event(seq: number, type: AgentEvent['type'], data: Record<string, unknown>, approvalId: string | null = null): AgentEvent {
  return {
    schema: 'seevee.agent-event.v1',
    seq,
    type,
    provider: 'codex',
    sessionId: 's1',
    turnId: 't1',
    approvalId,
    occurredAt: `2026-09-25T10:00:0${seq}.000Z`,
    data,
  };
}

function render(events: AgentEvent[]): string {
  const item = buildTimeline(events)[0];
  if (item === undefined) throw new Error('expected a timeline item');
  return renderToStaticMarkup(
    <TimelineItemView
      item={item}
      last
      busy={false}
      providerLabel="Codex"
      elicitationValue=""
      answers={{}}
      onAnswerChange={() => {}}
      onApproval={async () => {}}
      onElicitationChange={() => {}}
    />,
  );
}

const ASK = event(1, 'approval.requested', {
  provider: 'codex',
  kind: 'item/tool/requestUserInput',
  title: 'The agent needs your input',
  request: {
    questions: [{
      id: 'q_scope',
      question: 'New CV, or a new presentation for the existing CV?',
      options: [
        { label: 'New CV', description: 'Keeps Ada Lovelace untouched' },
        { label: 'New presentation', description: 'Re-styles the existing CV' },
      ],
    }],
  },
}, 'approval-1');

describe('ask-the-user card', () => {
  it('renders the question as a choice rather than raw JSON', () => {
    const markup = render([ASK]);
    expect(markup).toContain('class="agent-question"');
    expect(markup).toContain('New CV, or a new presentation for the existing CV?');
    expect(markup).toContain('type="radio"');
    expect(markup).not.toContain('Form response JSON');
  });

  it('always offers a free-text escape hatch', () => {
    const markup = render([ASK]);
    expect(markup).toContain('Something else');
    expect(markup).toContain('type="radio"');
  });

  it('keeps the permission approval flow unchanged for non-question requests', () => {
    const markup = render([event(1, 'approval.requested', {
      provider: 'codex',
      kind: 'item/fileChange/requestApproval',
      title: 'Approve edit to cv.json',
    }, 'approval-2')]);
    expect(markup).toContain('class="agent-approval"');
    expect(markup).toContain('Allow once');
  });

  it('shows a resolved question with the answer that was given', () => {
    const markup = render([
      ASK,
      event(2, 'approval.resolved', { decision: 'allow-once' }, 'approval-1'),
    ]);
    expect(markup).toContain('data-resolved="true"');
    expect(markup).not.toContain('Send answer');
  });
});
