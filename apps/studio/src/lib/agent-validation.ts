import { validateWorkspaceSemantics, type PresentationDocument } from '@seevee/schema';
import {
  listCvs,
  loadComments,
  loadPresentation,
  loadProvenance,
  loadSource,
  loadWorkspaceContextAt,
} from './workspace.js';

export interface AgentValidationResult {
  status: 'passed' | 'failed';
  checked: number;
  failures: Array<{ resource: string; reason: string }>;
  warnings: Array<{ code: string; message: string; path?: string }>;
}

export async function validateAgentWorkspace(workspaceRoot: string): Promise<AgentValidationResult> {
  const context = await loadWorkspaceContextAt(workspaceRoot);
  const failures: AgentValidationResult['failures'] = [];
  let checked = 0;
  const cvs = await listCvs(context);
  for (const result of cvs) {
    checked += 1;
    if (!result.ok) failures.push({ resource: result.kind, reason: result.reason });
  }
  for (const registration of Object.values(context.workspace.data.resources.presentations)) {
    checked += 1;
    const result = await loadPresentation(context.root, registration.relativePath);
    if (!result.ok) failures.push({ resource: `presentation:${registration.id}`, reason: result.reason });
  }
  for (const registration of Object.values(context.workspace.data.resources.provenance)) {
    checked += 1;
    const result = await loadProvenance(context.root, registration.relativePath);
    if (!result.ok) failures.push({ resource: `provenance:${registration.id}`, reason: result.reason });
  }
  for (const registration of Object.values(context.workspace.data.resources.comments)) {
    checked += 1;
    const result = await loadComments(context.root, registration.relativePath);
    if (!result.ok) failures.push({ resource: `comments:${registration.id}`, reason: result.reason });
  }
  for (const registration of Object.values(context.workspace.data.resources.sources)) {
    checked += 1;
    const result = await loadSource(context.root, registration.relativePath);
    if (!result.ok) failures.push({ resource: `source:${registration.id}`, reason: result.reason });
  }

  const activeCvResult = cvs.find((result) => result.ok && result.document.id === context.workspace.data.active.cvId);
  if (activeCvResult?.ok) {
    const activePresentationId = context.workspace.data.active.presentationId;
    const presentationRegistration = activePresentationId === null
      ? undefined
      : context.workspace.data.resources.presentations[activePresentationId];
    let presentation: PresentationDocument | undefined;
    if (presentationRegistration !== undefined) {
      const result = await loadPresentation(context.root, presentationRegistration.relativePath);
      if (result.ok) presentation = result.document;
    }
    const provenanceRegistration = Object.values(context.workspace.data.resources.provenance)
      .find((registration) => registration.cvId === activeCvResult.document.id);
    const commentsRegistration = Object.values(context.workspace.data.resources.comments)
      .find((registration) => registration.cvId === activeCvResult.document.id);
    const provenanceResult = provenanceRegistration === undefined
      ? undefined
      : await loadProvenance(context.root, provenanceRegistration.relativePath);
    const commentsResult = commentsRegistration === undefined
      ? undefined
      : await loadComments(context.root, commentsRegistration.relativePath);
    const semanticIssues = validateWorkspaceSemantics({
      workspace: context.workspace,
      cv: activeCvResult.document,
      ...(presentation === undefined ? {} : { presentation }),
      ...(provenanceResult?.ok === true ? { provenance: provenanceResult.document } : {}),
      ...(commentsResult?.ok === true ? { comments: commentsResult.document } : {}),
    });
    failures.push(...semanticIssues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({ resource: `semantic:${issue.code}`, reason: issue.message })));
    return {
      status: failures.length === 0 ? 'passed' : 'failed',
      checked,
      failures,
      warnings: semanticIssues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => ({ code: issue.code, message: issue.message, ...(issue.path === undefined ? {} : { path: issue.path }) })),
    };
  }

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    checked,
    failures,
    warnings: [],
  };
}
