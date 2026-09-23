import path from 'node:path';
import { z } from 'zod';
import {
  agentRunDocumentSchema,
  cvDocumentSchema,
  provenanceDocumentSchema,
  validateWorkspaceSemantics,
  workspaceDocumentSchema,
  type AgentRunCheck,
  type AgentRunDocument,
  type Actor,
} from '@seevee/schema';
import { runTool } from '../executor.js';
import type { IngestionRoleInput, IngestionRoleResult, RoleDeps, ToolDefinition, ToolRegistry } from '../types.js';
import { allAgentTools } from '../index.js';
/**
 * Ingestion role — the first role in the runtime pipeline.
 *
 * Reads the workspace, candidate CV, provenance, and the named source
 * blocks; runs deterministic schema/semantic checks; records the agent
 * run document at `<workspaceRoot>/.seevee/history/<runId>.json`.
 *
 * No LLM is involved; mutation tools are intentionally stubbed. When the
 * role detects ambiguity (missing CV, missing source block, or unsupported
 * facts), it returns a `blockedReason` rather than guessing.
 */

const SCHEMA_VERSION = '1.0.0' as const;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function check(
  id: string,
  status: 'pass' | 'fail' | 'warn' | 'skipped',
  message?: string,
): AgentRunCheck {
  const base = { id, type: 'schema-valid' as const, status };
  return message === undefined ? base : { ...base, message };
}

function semanticCheck(status: 'pass' | 'fail', message?: string): AgentRunCheck {
  const base = { id: 'semantic', type: 'semantic-valid' as const, status };
  return message === undefined ? base : { ...base, message };
}

function zodIssueMessage(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

function safeFileId(value: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`identifier '${value}' is not a safe filename component`);
  }
  return value;
}

interface WorkspaceGetOutput {
  readonly document: Record<string, unknown>;
  readonly relativePath: string;
  readonly revision: number;
}

interface CvGetOutput {
  readonly document: Record<string, unknown>;
  readonly relativePath: string;
  readonly revision: number;
}

interface ProvenanceGetOutput {
  readonly document: Record<string, unknown>;
  readonly relativePath: string;
}

interface SourcesListOutput {
  readonly sources: ReadonlyArray<{ readonly id: string; readonly relativePath: string }>;
}

export async function executeIngestionRole(
  input: IngestionRoleInput,
  deps: RoleDeps,
): Promise<IngestionRoleResult> {
  const startedAt = deps.now();
  const runId = safeFileId(deps.randomId());
  const actor: Actor = input.actor ?? { kind: 'system' };
  const checks: AgentRunCheck[] = [];
  const inputRevisions: Record<string, number> = {};
  const blockers: string[] = [];
  const opts = { deps, workspaceRoot: input.workspaceRoot, runId };

  // --- 1. Workspace document must be schema-valid.
  const workspaceResult = await runTool(
    deps.toolRegistry,
    'workspace.get',
    { workspaceRoot: input.workspaceRoot },
    opts,
  );
  if (!workspaceResult.ok) {
    return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
      check('blocked', 'fail', `workspace.get failed: ${workspaceResult.error}`),
    ], `workspace.get failed: ${workspaceResult.error}`);
  }
  const workspaceDocument = workspaceResult.output.document;
  const workspaceParsed = workspaceDocumentSchema.safeParse(workspaceDocument);
  if (!workspaceParsed.success) {
    const message = `workspace document is not schema-valid: ${zodIssueMessage(workspaceParsed.error)}`;
    return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
      check('blocked', 'fail', message),
    ], message);
  }
  checks.push(check('workspace-schema', 'pass'));
  inputRevisions['seevee.workspace'] = workspaceParsed.data.revision;

  // --- 2. The candidate CV must be schema-valid.
  const cvResult = await runTool(
    deps.toolRegistry,
    'cv.get',
    { workspaceRoot: input.workspaceRoot, cvId: input.candidateCvId },
    opts,
  );
  if (!cvResult.ok) {
    return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
      check('blocked', 'fail', `cv.get failed: ${cvResult.error}`),
    ], `cv.get failed: ${cvResult.error}`);
  }
  const cvDocument = cvResult.output.document;
  const cvParsed = cvDocumentSchema.safeParse(cvDocument);
  if (!cvParsed.success) {
    checks.push(check('cv-schema', 'fail', zodIssueMessage(cvParsed.error)));
    blockers.push(`candidate CV '${input.candidateCvId}' is not schema-valid`);
    return persistCompleted(input.workspaceRoot, runId, actor, startedAt, deps, checks, inputRevisions, blockers);
  }
  checks.push(check('cv-schema', 'pass'));
  inputRevisions['seevee.cv'] = cvParsed.data.revision;

  // --- 3. Provenance document must be schema-valid when present.
  const provenanceResult = await runTool(
    deps.toolRegistry,
    'provenance.get',
    { workspaceRoot: input.workspaceRoot, cvId: input.candidateCvId },
    opts,
  );
  let provenanceDocument: Record<string, unknown> | undefined;
  if (provenanceResult.ok) {
    provenanceDocument = provenanceResult.output.document;
    const provenanceParsed = provenanceDocumentSchema.safeParse(provenanceDocument);
    if (!provenanceParsed.success) {
      checks.push(check('provenance-schema', 'fail', zodIssueMessage(provenanceParsed.error)));
      blockers.push(`provenance for '${input.candidateCvId}' is not schema-valid`);
      return persistCompleted(input.workspaceRoot, runId, actor, startedAt, deps, checks, inputRevisions, blockers);
    }
    checks.push(check('provenance-schema', 'pass'));
    inputRevisions['seevee.provenance'] = provenanceParsed.data.revision;
  } else {
    checks.push(check('provenance-schema', 'skipped', provenanceResult.error));
  }

  // --- 4. Source blocks referenced must be resolvable; if any are missing we block.
  if (input.sourceBlockIds.length > 0) {
    const invalid = input.sourceBlockIds.filter((id) => !ID_PATTERN.test(id));
    if (invalid.length > 0) {
      const message = `invalid source block ids: ${invalid.join(', ')}`;
      return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
        check('blocked', 'fail', message),
      ], message);
    }
    const sourcesResult = await runTool(
      deps.toolRegistry,
      'sources.list',
      { workspaceRoot: input.workspaceRoot },
      opts,
    );
    if (!sourcesResult.ok) {
      return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
        check('blocked', 'fail', `sources.list failed: ${sourcesResult.error}`),
      ], `sources.list failed: ${sourcesResult.error}`);
    }
    const known = new Set(sourcesResult.output.sources.map((entry: { id: string }) => entry.id));
    const missing = input.sourceBlockIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      const message = `source block ids not registered: ${missing.join(', ')}`;
      return persistBlocked(input.workspaceRoot, runId, actor, startedAt, deps, [
        check('blocked', 'fail', message),
      ], message);
    }
    checks.push(check('source-blocks-resolvable', 'pass'));
  } else {
    checks.push(check('source-blocks-resolvable', 'skipped', 'no source block ids supplied'));
  }

  // --- 5. Semantic validation over the workspace/cv/provenance triple.
  const issues = validateWorkspaceSemantics({
    workspace: workspaceDocumentSchema.parse(workspaceDocument),
    cv: cvDocumentSchema.parse(cvDocument),
    provenance: provenanceDocument ? provenanceDocumentSchema.parse(provenanceDocument) : undefined,
  });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    checks.push(semanticCheck('fail', errors.map((issue) => issue.message).join('; ')));
    blockers.push('semantic validation reported errors');
    return persistCompleted(input.workspaceRoot, runId, actor, startedAt, deps, checks, inputRevisions, blockers);
  }
  checks.push(semanticCheck('pass'));

  // --- 6. Successful ingestion: no change sets are produced in this scaffold.
  const runRecord = buildRunRecord({
    runId,
    startedAt,
    completedAt: deps.now(),
    actor,
    checks,
    inputRevisions,
    summary: `Ingested ${input.sourceBlockIds.length} source block(s) into CV '${input.candidateCvId}'.`,
  });
  await persistRunRecord(input.workspaceRoot, runRecord, deps);
  return { runRecord };
}

interface BuildRecordArgs {
  readonly runId: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly actor: Actor;
  readonly checks: AgentRunCheck[];
  readonly inputRevisions: Record<string, number>;
  readonly summary: string;
}

function buildRunRecord(args: BuildRecordArgs): AgentRunDocument {
  return agentRunDocumentSchema.parse({
    kind: 'seevee.agent-run',
    schemaVersion: SCHEMA_VERSION,
    id: args.runId,
    type: 'ingestion',
    state: 'completed',
    inputRevisions: args.inputRevisions,
    commentIds: [],
    changeSetIds: [],
    checks: args.checks,
    summary: args.summary,
    startedAt: args.startedAt.toISOString(),
    completedAt: args.completedAt.toISOString(),
    extensions: { 'seevee.actor': args.actor },
  });
}

async function persistRunRecord(
  workspaceRoot: string,
  runRecord: AgentRunDocument,
  deps: RoleDeps,
): Promise<void> {
  const historyDir = path.join(workspaceRoot, '.seevee', 'history');
  const filePath = path.join(historyDir, `${safeFileId(runRecord.id)}.json`);
  await deps.writeFile(filePath, `${JSON.stringify(runRecord, null, 2)}\n`);
}

async function persistCompleted(
  workspaceRoot: string,
  runId: string,
  actor: Actor,
  startedAt: Date,
  deps: RoleDeps,
  checks: AgentRunCheck[],
  inputRevisions: Record<string, number>,
  blockers: string[],
): Promise<IngestionRoleResult> {
  const runRecord = buildRunRecord({
    runId,
    startedAt,
    completedAt: deps.now(),
    actor,
    checks,
    inputRevisions,
    summary: `Blocked: ${blockers.join('; ')}`,
  });
  await persistRunRecord(workspaceRoot, runRecord, deps);
  return { runRecord, blockedReason: blockers.join('; ') };
}

async function persistBlocked(
  workspaceRoot: string,
  runId: string,
  actor: Actor,
  startedAt: Date,
  deps: RoleDeps,
  checks: AgentRunCheck[],
  blockedReason: string,
): Promise<IngestionRoleResult> {
  const runRecord = buildRunRecord({
    runId,
    startedAt,
    completedAt: deps.now(),
    actor,
    checks,
    inputRevisions: {},
    summary: `Blocked: ${blockedReason}`,
  });
  await persistRunRecord(workspaceRoot, runRecord, deps);
  return { runRecord, blockedReason };
}

// Reference the `ToolDefinition` type so editors resolve the public type
// even when this file does not export a tool directly.
export type _IngestionToolReference = ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>;
