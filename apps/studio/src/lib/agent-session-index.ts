import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { agentProviderIdSchema, type AgentSessionSummary } from '@seevee/agent-runtime';

const savedSessionSchema = z.object({
  id: z.string().min(1),
  provider: agentProviderIdSchema,
  externalSessionId: z.string().min(1),
  title: z.string(),
  state: z.string(),
  model: z.string().nullable(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
});

const sessionIndexSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(savedSessionSchema),
});

export type SavedAgentSession = z.infer<typeof savedSessionSchema>;

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

export async function persistAgentSession(workspaceRoot: string, session: AgentSessionSummary): Promise<void> {
  if (session.externalSessionId === null) return;
  const sessions = await readAgentSessionIndex(workspaceRoot);
  const saved: SavedAgentSession = {
    id: session.id,
    provider: session.provider,
    externalSessionId: session.externalSessionId,
    title: session.title,
    state: session.state,
    model: session.model,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
  };
  const next = [saved, ...sessions.filter((item) => item.externalSessionId !== saved.externalSessionId)].slice(0, 50);
  const directory = path.join(workspaceRoot, '.seevee');
  await fs.mkdir(directory, { recursive: true });
  const target = indexPath(workspaceRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, sessions: next }, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
}
