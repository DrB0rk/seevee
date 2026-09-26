import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { agentProviderIdSchema, type AgentSessionSummary } from '@seevee/agent-runtime';

/**
 * A prompt the user sent in this workspace. The provider's event stream only
 * ever reports what the *agent* said, so without this the user's half of a
 * conversation disappears on reload — the transcript has to be assembled from
 * both sides.
 */
const savedPromptSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  createdAt: z.string(),
});

export type SavedAgentPrompt = z.infer<typeof savedPromptSchema>;

const savedSessionSchema = z.object({
  id: z.string().min(1),
  provider: agentProviderIdSchema,
  externalSessionId: z.string().min(1),
  title: z.string(),
  state: z.string(),
  model: z.string().nullable(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  // `default` keeps every index written before prompts were recorded readable.
  prompts: z.array(savedPromptSchema).default([]),
});

const sessionIndexSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(savedSessionSchema),
});

export type SavedAgentSession = z.infer<typeof savedSessionSchema>;

const MAX_SESSIONS = 50;
const MAX_PROMPTS_PER_SESSION = 200;

function indexPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.seevee', 'agent-sessions.json');
}

export async function readAgentSessionIndex(workspaceRoot: string): Promise<SavedAgentSession[]> {
  try {
    const raw = await fs.readFile(indexPath(workspaceRoot), 'utf8');
    return sessionIndexSchema.parse(JSON.parse(raw)).sessions;
  } catch {
    return [];
  }
}

function toSaved(session: AgentSessionSummary, prompts: SavedAgentPrompt[]): SavedAgentSession {
  return {
    id: session.id,
    provider: session.provider,
    externalSessionId: session.externalSessionId ?? '',
    title: session.title,
    state: session.state,
    model: session.model,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    prompts,
  };
}

async function writeAgentSessionIndex(workspaceRoot: string, sessions: SavedAgentSession[]): Promise<void> {
  const directory = path.join(workspaceRoot, '.seevee');
  await fs.mkdir(directory, { recursive: true });
  const target = indexPath(workspaceRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, sessions }, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}

export async function persistAgentSession(workspaceRoot: string, session: AgentSessionSummary): Promise<void> {
  if (session.externalSessionId === null) return;
  const sessions = await readAgentSessionIndex(workspaceRoot);
  const existing = sessions.find((item) => item.externalSessionId === session.externalSessionId);
  const saved = toSaved(session, existing?.prompts ?? []);
  await writeAgentSessionIndex(
    workspaceRoot,
    [saved, ...sessions.filter((item) => item.externalSessionId !== saved.externalSessionId)].slice(0, MAX_SESSIONS),
  );
}

/**
 * Record a prompt the user just sent. Runs as soon as the prompt is accepted,
 * not at turn end, so an interrupted or still-running turn keeps its history.
 */
export async function recordAgentSessionPrompt(
  workspaceRoot: string,
  session: AgentSessionSummary,
  prompt: SavedAgentPrompt,
): Promise<void> {
  if (session.externalSessionId === null) return;
  const sessions = await readAgentSessionIndex(workspaceRoot);
  const existing = sessions.find((item) => item.externalSessionId === session.externalSessionId);
  const prompts = [...(existing?.prompts ?? []).filter((item) => item.id !== prompt.id), prompt]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_PROMPTS_PER_SESSION);
  const saved = toSaved(session, prompts);
  await writeAgentSessionIndex(
    workspaceRoot,
    [saved, ...sessions.filter((item) => item.externalSessionId !== saved.externalSessionId)].slice(0, MAX_SESSIONS),
  );
}
