/**
 * @seevee/agent-runtime — typed tool boundary and revision-checked executor
 * for Seevee agents.
 *
 * This package is the foundation the dashboard and CLI call into. It
 * exposes a typed tool registry, a revision-aware executor, and the first
 * role entry point (`executeIngestionRole`). It performs no LLM calls and
 * implements no mutation tools: any tool whose name is on the §3 mutating
 * list throws `Error('mutation tool requires review: <name>')` so callers
 * know they must wire it through a review/approval surface.
 */

export {
  defineTools,
  runTool,
  RevisionMismatchError,
  ToolNotFoundError,
  FactPolicyError,
  mutationToolError,
} from './executor.js';

export type {
  ToolDefinition,
  ToolRegistry,
  ToolContext,
  RunToolResult,
  RoleDeps,
  IngestionRoleInput,
  IngestionRoleResult,
  IngestionRoleSuccess,
  IngestionRoleBlocked,
  AgentRunDocument,
} from './types.js';

export { executeIngestionRole } from './roles/ingestion.js';
export { AgentRuntimeManager, AgentRuntimeError } from './control/manager.js';
export type { AgentEventSink } from './control/manager.js';
export type {
  AdapterApprovalResolution,
  AdapterPromptOptions,
  AdapterSession,
  AgentAdapter,
  CreateAdapterSessionOptions,
} from './control/adapter.js';
export {
  createAgentSessionSchema,
  promptAgentSchema,
  resolveAgentApprovalSchema,
  updateAgentSessionSchema,
  agentProviderIdSchema,
  agentCapabilitiesSchema,
  agentSessionStateSchema,
  DEFAULT_AGENT_CAPABILITIES,
} from './control/types.js';
export type {
  AgentCapabilities,
  AgentEvent,
  AgentEventInput,
  AgentEventType,
  AgentPromptDelivery,
  AgentPromptResult,
  AgentProviderDescriptor,
  AgentProviderId,
  AgentRuntimeSnapshot,
  AgentSelectOption,
  AgentSessionConfiguration,
  AgentSessionState,
  AgentSessionSummary,
  CreateAgentSessionRequest,
  PromptAgentRequest,
  ResolveAgentApprovalRequest,
  UpdateAgentSessionRequest,
} from './control/types.js';
export { createDefaultAgentAdapters, ClaudeCodeAdapter, CodexAdapter, OmpAdapter } from './adapters/index.js';

export { workspaceGetTool, workspacePutTool, workspaceListTool, workspaceTools } from './tools/workspace.js';
export {
  cvListTool,
  cvGetTool,
  cvCreateTool,
  cvDuplicateTool,
  cvProposeChangesTool,
  cvTools,
} from './tools/cv.js';
export { provenanceGetTool, provenanceAssertTool, provenanceTools } from './tools/provenance.js';
export {
  presentationListTool,
  presentationGetTool,
  presentationCreateTool,
  presentationProposeChangesTool,
  presentationTools,
} from './tools/presentation.js';
export { commentsListTool, commentsGetTool, commentsSetWorkStateTool, commentsTools } from './tools/comments.js';
export { sourcesListTool, sourcesReadExtractTool, sourcesTools } from './tools/sources.js';
export {
  templatesListTool,
  templatesReadManifestTool,
  templatesReadSourceTool,
  templatesCreateDraftTool,
  templatesPatchDraftFileTool,
  templatesValidateTool,
  templatesCompileTool,
  templatesActivateTool,
  templatesTools,
} from './tools/templates.js';
export { historyListTool, historyTools } from './tools/history.js';
export { renderPreviewTool, renderInspectLayoutTool, exportPdfTool, exportTools } from './tools/export.js';

import type { z } from 'zod';
import type { ToolContext, ToolDefinition } from './types.js';
import { defineTools } from './executor.js';
import { workspaceTools } from './tools/workspace.js';
import { cvTools } from './tools/cv.js';
import { provenanceTools } from './tools/provenance.js';
import { presentationTools } from './tools/presentation.js';
import { commentsTools } from './tools/comments.js';
import { sourcesTools } from './tools/sources.js';
import { templatesTools } from './tools/templates.js';
import { historyTools } from './tools/history.js';
import { exportTools } from './tools/export.js';

/**
 * Structural shape of any tool definition, regardless of its concrete Zod
 * input/output schemas. Used solely to assemble the canonical agent tool
 * registry without forcing every tool's specific generics into a single
 * invariant slot.
 */
interface AnyTool {
  readonly name: string;
  readonly description?: string;
  readonly input: z.ZodTypeAny;
  readonly output: z.ZodTypeAny;
  readonly requiresBaseRevision?: boolean;
  readonly handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

const orderedTools: ReadonlyArray<AnyTool> = [
  ...workspaceTools,
  ...cvTools,
  ...provenanceTools,
  ...presentationTools,
  ...commentsTools,
  ...sourcesTools,
  ...templatesTools,
  ...historyTools,
  ...exportTools,
] as ReadonlyArray<AnyTool>;

const registryMap: Record<string, ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>> = {};
for (const tool of orderedTools) {
  if (registryMap[tool.name]) {
    throw new Error(`duplicate tool name registered: ${tool.name}`);
  }
  registryMap[tool.name] = tool as ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>;
}

/**
 * The full tool surface registered for hosted-mode agents. The keys of
 * the resulting record are the canonical §3 tool names.
 */
export const allAgentTools = defineTools(registryMap);
