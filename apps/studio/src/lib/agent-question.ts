/**
 * Ask-the-user question extraction.
 *
 * Providers ask the user for input through different RPC methods with
 * different payload shapes: Codex sends `item/tool/requestUserInput`, MCP
 * servers send `mcpServer/elicitation/request`, and OMP sends the ACP
 * `elicitation/create`. None of them share a schema, so this parses
 * defensively — it recognises the common shapes and returns `null` when it
 * cannot, so the caller can fall back to a raw payload view rather than
 * showing an empty question.
 */

export interface QuestionOption {
  label: string;
  description: string | null;
}

export interface AgentQuestion {
  id: string | null;
  question: string;
  options: QuestionOption[];
  /** True when the provider says a free-text answer is acceptable. */
  allowsOther: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function parseOption(raw: unknown): QuestionOption | null {
  if (typeof raw === 'string') return raw.trim().length > 0 ? { label: raw.trim(), description: null } : null;
  if (!isRecord(raw)) return null;
  const label = firstString(raw, ['label', 'title', 'name', 'text', 'value']);
  if (label === null) return null;
  return { label, description: firstString(raw, ['description', 'detail', 'hint']) };
}

function parseQuestion(raw: unknown, index: number): AgentQuestion | null {
  if (!isRecord(raw)) return null;
  const question = firstString(raw, ['question', 'prompt', 'text', 'header', 'title', 'message']);
  if (question === null) return null;
  const rawOptions = raw['options'] ?? raw['choices'] ?? raw['enum'] ?? raw['values'];
  const options = Array.isArray(rawOptions)
    ? rawOptions.map(parseOption).filter((option): option is QuestionOption => option !== null)
    : [];
  const allowsOther = raw['allowOther'] === true
    || raw['allowFreeForm'] === true
    || raw['allowOtherText'] === true
    || raw['freeForm'] === true;
  const id = firstString(raw, ['id', 'key', 'name']);
  return { id, question, options, allowsOther: allowsOther || options.length === 0 };
}

/**
 * Pull questions out of an approval request payload. Looks at the request
 * itself and one level of common containers (`params`, `request`, `input`,
 * `payload`, `elicitation`).
 */
export function extractAgentQuestions(raw: unknown): AgentQuestion[] {
  if (!isRecord(raw)) return [];
  const containers: Record<string, unknown>[] = [raw];
  for (const key of ['params', 'request', 'input', 'payload', 'elicitation', 'data']) {
    const nested = raw[key];
    if (isRecord(nested)) containers.push(nested);
  }

  const questions: AgentQuestion[] = [];
  const seen = new Set<string>();
  for (const container of containers) {
    for (const key of ['questions', 'items', 'prompts', 'fields']) {
      const list = container[key];
      if (!Array.isArray(list)) continue;
      list.forEach((entry, index) => {
        const parsed = parseQuestion(entry, index);
        if (parsed === null) return;
        const signature = `${parsed.question}::${parsed.options.map((option) => option.label).join('|')}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        questions.push(parsed);
      });
    }
    // A single-question payload that is not wrapped in an array.
    if (questions.length === 0) {
      const single = parseQuestion(container, 0);
      if (single !== null && single.options.length > 0) questions.push(single);
    }
  }
  return questions;
}

/** True when the request is the agent asking the user something, not a permission prompt. */
export function isUserQuestionRequest(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const kind = typeof raw['kind'] === 'string' ? raw['kind'] : '';
  if (kind.includes('requestUserInput') || kind.includes('elicitation')) return true;
  return extractAgentQuestions(raw['request'] ?? raw).length > 0;
}

/** Build the provider response payload for a chosen answer. */
export function buildAnswerPayload(questions: readonly AgentQuestion[], answers: readonly string[]): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  questions.forEach((question, index) => {
    const answer = answers[index] ?? '';
    if (answer.length === 0) return;
    const key = question.id ?? `question_${index + 1}`;
    const option = question.options.find((candidate) => candidate.label === answer);
    responses[key] = option === undefined ? answer : { answer };
  });
  return { answers: responses };
}
