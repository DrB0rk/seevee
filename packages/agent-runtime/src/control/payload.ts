const REDACTED_KEYS: Record<string, true> = {
  authorization: true,
  cookie: true,
  password: true,
  secret: true,
  token: true,
  access_token: true,
  refresh_token: true,
  api_key: true,
  apiKey: true,
  client_secret: true,
};

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 32_000;

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sanitizeAgentValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    const bounded = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeAgentValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) bounded.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return bounded;
  }
  if (typeof value !== 'object' || value === null) return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ARRAY_ITEMS)) {
    output[key] = REDACTED_KEYS[key] ? '[redacted]' : sanitizeAgentValue(item, depth + 1);
  }
  return output;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
