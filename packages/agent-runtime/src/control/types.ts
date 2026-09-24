import { z } from 'zod';

export const AGENT_PROVIDER_IDS = ['claude-code', 'codex', 'omp'] as const;
export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_IDS);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;

export const agentCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  reasoning: z.boolean(),
  toolCalls: z.boolean(),
  approvals: z.boolean(),
  steering: z.boolean(),
  sessionResume: z.boolean(),
  modelSelection: z.boolean(),
  usage: z.boolean(),
  subagents: z.boolean(),
  mcp: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

export interface AgentSelectOption {
  id: string;
  label: string;
  description: string | null;
}

export interface AgentSessionConfiguration {
  model: string | null;
  permissionMode: string;
  models: AgentSelectOption[];
  permissions: AgentSelectOption[];
}

export type AgentProviderStatus = 'ready' | 'installed' | 'not-installed' | 'incompatible' | 'error';

export interface AgentProviderDescriptor {
  id: AgentProviderId;
  label: string;
  command: string;
  installed: boolean;
  status: AgentProviderStatus;
  version: string | null;
  executablePath: string | null;
  ready: boolean;
  capabilities: AgentCapabilities;
  message: string | null;
}

export const agentSessionStateSchema = z.enum([
  'starting',
  'idle',
  'running',
  'waiting-approval',
  'completed',
  'failed',
  'cancelled',
  'closed',
]);
export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

export interface AgentSessionSummary {
  id: string;
  provider: AgentProviderId;
  externalSessionId: string | null;
  title: string;
  state: AgentSessionState;
  model: string | null;
  createdAt: string;
  lastActivityAt: string;
  capabilities: AgentCapabilities;
  error: string | null;
}

export type AgentEventType =
  | 'session.created'
  | 'session.state'
  | 'turn.queued'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'
  | 'message.started'
  | 'message.delta'
  | 'message.completed'
  | 'reasoning.delta'
  | 'plan.updated'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'usage.updated'
  | 'subactivity.updated'
  | 'provider.extra'
  | 'workspace.changed'
  | 'validation.started'
  | 'validation.completed'
  | 'error';

export interface AgentEvent<TData = unknown> {
  schema: 'seevee.agent-event.v1';
  seq: number;
  type: AgentEventType;
  provider: AgentProviderId;
  sessionId: string;
  turnId: string | null;
  approvalId: string | null;
  occurredAt: string;
  data: TData;
}

export type AgentEventInput = Omit<AgentEvent, 'schema' | 'seq' | 'provider' | 'sessionId' | 'occurredAt'> & {
  occurredAt?: string;
};

export type AgentPromptDelivery = 'auto' | 'steer' | 'queue';

export const createAgentSessionSchema = z.object({
  provider: agentProviderIdSchema,
  resumeSessionId: z.string().min(1).max(512).optional(),
});
export type CreateAgentSessionRequest = z.infer<typeof createAgentSessionSchema>;

export const promptAgentSchema = z.object({
  text: z.string().trim().min(1).max(32_000),
  delivery: z.enum(['auto', 'steer', 'queue']).default('auto'),
});
export type PromptAgentRequest = z.infer<typeof promptAgentSchema>;

export const resolveAgentApprovalSchema = z.object({
  approvalId: z.string().min(1).max(256),
  decision: z.enum(['allow-once', 'allow-session', 'deny', 'cancel']),
  optionId: z.string().min(1).max(256).optional(),
  message: z.string().max(2_000).optional(),
  value: z.unknown().optional(),
});
export type ResolveAgentApprovalRequest = z.infer<typeof resolveAgentApprovalSchema>;

export const updateAgentSessionSchema = z.object({
  model: z.string().trim().min(1).max(512).optional(),
  permissionMode: z.string().trim().min(1).max(64).optional(),
});
export type UpdateAgentSessionRequest = z.infer<typeof updateAgentSessionSchema>;

export interface AgentPromptResult {
  turnId: string | null;
  queued: boolean;
  mode: 'new-turn' | 'queued' | 'steered';
}

export interface AgentRuntimeSnapshot {
  schema: 'seevee.agent-runtime.snapshot.v1';
  seq: number;
  providers: AgentProviderDescriptor[];
  sessions: AgentSessionSummary[];
  events: AgentEvent[];
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  reasoning: true,
  toolCalls: true,
  approvals: true,
  steering: false,
  sessionResume: true,
  modelSelection: true,
  usage: true,
  subagents: false,
  mcp: true,
};
