import { describe, expect, it } from 'vitest';

import { buildAnswerPayload, extractAgentQuestions, isUserQuestionRequest } from '../src/lib/agent-question.js';

describe('agent question extraction', () => {
  it('reads a Codex requestUserInput payload with options', () => {
    const request = {
      kind: 'item/tool/requestUserInput',
      request: {
        turnId: 'turn-1',
        questions: [{
          id: 'q_scope',
          question: 'Should this be a new CV or a new presentation?',
          options: [
            { label: 'New CV', description: 'Create a separate CV document' },
            { label: 'New presentation', description: 'Re-style the existing CV' },
          ],
        }],
      },
    };
    expect(isUserQuestionRequest(request)).toBe(true);
    const questions = extractAgentQuestions(request);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.question).toBe('Should this be a new CV or a new presentation?');
    expect(questions[0]?.options.map((option) => option.label)).toEqual(['New CV', 'New presentation']);
  });

  it('reports whether the provider itself accepts a free-text answer', () => {
    const open = extractAgentQuestions({
      questions: [{ question: 'Pick one', options: [{ label: 'A' }], allowOther: true }],
    });
    const closed = extractAgentQuestions({
      questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
    });
    expect(open[0]?.allowsOther).toBe(true);
    // The chat always renders a "Something else" field regardless, so this
    // only records the provider's own preference.
    expect(closed[0]?.allowsOther).toBe(false);
  });

  it('reads plain string options', () => {
    const questions = extractAgentQuestions({ items: [{ prompt: 'Pick', choices: ['A', 'B'] }] });
    expect(questions[0]?.options.map((option) => option.label)).toEqual(['A', 'B']);
  });

  it('treats a question with no options as free text rather than dropping it', () => {
    const questions = extractAgentQuestions({ questions: [{ question: 'What should the header say?' }] });
    expect(questions).toHaveLength(1);
    expect(questions[0]?.options).toEqual([]);
  });

  it('does not duplicate a question reachable through two containers', () => {
    const questions = extractAgentQuestions({
      params: { questions: [{ id: 'q1', question: 'Same?', options: [{ label: 'A' }] }] },
      request: { questions: [{ id: 'q1', question: 'Same?', options: [{ label: 'A' }] }] },
    });
    expect(questions).toHaveLength(1);
  });

  it('returns nothing for a permission request with no question', () => {
    const request = { kind: 'item/fileChange/requestApproval', request: { path: '/root/a.ts' } };
    expect(extractAgentQuestions(request)).toEqual([]);
  });

  it('returns nothing for a payload it cannot understand', () => {
    expect(extractAgentQuestions(null)).toEqual([]);
    expect(extractAgentQuestions({ unrelated: 42 })).toEqual([]);
    expect(isUserQuestionRequest('nope')).toBe(false);
  });

  it('builds an answer payload keyed by question id', () => {
    const questions = extractAgentQuestions({
      questions: [
        { id: 'q1', question: 'One?', options: [{ label: 'A' }, { label: 'B' }] },
        { id: 'q2', question: 'Two?', options: [{ label: 'C' }] },
      ],
    });
    expect(buildAnswerPayload(questions, ['B', 'something else'])).toEqual({
      answers: { q1: { answer: 'B' }, q2: 'something else' },
    });
  });

  it('omits unanswered questions from the payload', () => {
    const questions = extractAgentQuestions({
      questions: [{ id: 'q1', question: 'One?', options: [{ label: 'A' }] }],
    });
    expect(buildAnswerPayload(questions, [''])).toEqual({ answers: {} });
  });
});
