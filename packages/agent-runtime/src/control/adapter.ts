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
  /** Fully rendered system instructions, including workspace context. */
  instructions: string;
  /** Extra environment for the provider process. Defaults to the host env. */
  env?: NodeJS.ProcessEnv;
  emit: (event: AgentEventInput) => void;
  signal: AbortSignal;
}

/**
 * How long `interrupt` waits for the provider's own terminal turn event before
 * reporting that the stop went unconfirmed. Long enough for a real stop on a
 * busy turn, short enough that the UI's Stop control never spins indefinitely.
 */
export const CANCEL_CONFIRMATION_TIMEOUT_MS = 15_000;

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
