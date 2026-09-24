import type {
  AgentCapabilities,
  AgentEventInput,
  AgentPromptDelivery,
  AgentPromptResult,
  AgentProviderDescriptor,
  AgentProviderId,
  AgentSessionConfiguration,
} from './types.js';

export interface CreateAdapterSessionOptions {
  workspaceRoot: string;
  executablePath: string;
  resumeSessionId?: string;
  emit: (event: AgentEventInput) => void;
  signal: AbortSignal;
}

export interface AdapterPromptOptions {
  text: string;
  delivery: AgentPromptDelivery;
}

export interface AdapterApprovalResolution {
  decision: 'allow-once' | 'allow-session' | 'deny' | 'cancel';
  optionId?: string;
  message?: string;
  value?: unknown;
}

export interface AdapterSession {
  readonly externalSessionId: string | null;
  readonly capabilities: AgentCapabilities;
  sendPrompt(options: AdapterPromptOptions): Promise<AgentPromptResult>;
  interrupt(): Promise<void>;
  resolveApproval(approvalId: string, resolution: AdapterApprovalResolution): Promise<void>;
  updateConfig(options: { model?: string; permissionMode?: string }): Promise<void>;
  getConfiguration(): Promise<AgentSessionConfiguration>;
  close(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: AgentProviderId;
  readonly command: string;
  detect(): Promise<AgentProviderDescriptor>;
  createSession(options: CreateAdapterSessionOptions): Promise<AdapterSession>;
}
