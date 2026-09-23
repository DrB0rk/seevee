// Canonical-resource validation. The export pipeline never accepts a
// raw JSON dump: every CV / workspace / presentation document is run
// through the corresponding Zod schema and then through
// `validateWorkspaceSemantics` from `@seevee/schema/semantic`. We
// collect every issue from both passes and report them together as a
// `ValidationError` so callers can fix everything in one round-trip.

import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

import {
  cvDocumentSchema,
  presentationDocumentSchema,
  workspaceDocumentSchema,
  type CvDocument,
  type PresentationDocument,
  type WorkspaceDocument,
  validateWorkspaceSemantics,
  type SemanticIssue,
} from '@seevee/schema';

import {
  ValidationError,
  type ValidationIssue,
} from './errors.js';

/**
 * Fully-resolved canonical resources, already validated. The CV,
 * workspace, and presentation are linked: `cvId` and `presentationId`
 * were resolved against `workspace.data.resources`. The caller can
 * hand these straight to `renderPresentationToHtml`.
 */
export interface ValidatedResources {
  readonly workspace: WorkspaceDocument;
  readonly cv: CvDocument;
  readonly presentation: PresentationDocument;
  readonly resolvedPresentationId: string;
}

interface SafeParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues: readonly { path: readonly (string | number)[]; message: string }[];
}

/**
 * Resolve, read, and validate the canonical resources required for an
 * export. Throws `ValidationError` when any resource fails structural
 * Zod validation or when `validateWorkspaceSemantics` reports an
 * error-severity issue.
 */
export async function loadValidatedResources(options: {
  readonly workspaceRoot: string;
  readonly cvId: string;
  readonly presentationId?: string;
  /**
   * Override for tests. Receives the absolute workspace root and the
   * relative path of a resource and returns the parsed text.
   */
  readonly read?: (absPath: string) => Promise<string>;
}): Promise<ValidatedResources> {
  const read = options.read ?? defaultRead;
  const root = assertAbsolute(options.workspaceRoot, 'workspaceRoot');

  const workspacePath = resolve(root, 'seevee.json');
  const workspaceText = await read(workspacePath);
  const workspace = parseWorkspaceEnvelope(workspaceText);

  const cvResource = workspace.data.resources.cvs[options.cvId];
  if (cvResource === undefined) {
    throw new ValidationError(
      `workspace: cv resource '${options.cvId}' is not registered`,
    );
  }
  const cvPath = resolve(root, cvResource.relativePath);
  const cvText = await read(cvPath);
  const cv = parseEnvelope(cvDocumentSchema, cvText, 'cv');

  const resolvedPresentationId =
    options.presentationId ?? workspace.data.active.presentationId;
  const presentationResource =
    workspace.data.resources.presentations[resolvedPresentationId];
  if (presentationResource === undefined) {
    throw new ValidationError(
      `workspace: presentation '${resolvedPresentationId}' is not registered`,
    );
  }
  const presentationPath = resolve(root, presentationResource.relativePath);
  const presentationText = await read(presentationPath);
  const presentation = parseEnvelope(
    presentationDocumentSchema,
    presentationText,
    'presentation',
  );
  if (presentation.data.cvId !== options.cvId) {
    throw new ValidationError(
      `presentation.cvId='${presentation.data.cvId}' does not match the requested cvId='${options.cvId}'`,
    );
  }
  if (presentationResource.templateId !== presentation.data.template.templateId) {
    throw new ValidationError(
      `workspace.presentation[${resolvedPresentationId}].templateId='${presentationResource.templateId}' does not match presentation.template.templateId='${presentation.data.template.templateId}'`,
    );
  }
  if (
    presentationResource.versionId !== presentation.data.template.versionId
  ) {
    throw new ValidationError(
      `workspace.presentation[${resolvedPresentationId}].versionId='${presentationResource.versionId}' does not match presentation.template.versionId='${presentation.data.template.versionId}'`,
    );
  }

  const semanticIssues = validateWorkspaceSemantics({
    cv,
    workspace,
    presentation,
  });
  const fatalSemantic: SemanticIssue[] = semanticIssues.filter(
    (issue) => issue.severity === 'error',
  );
  if (fatalSemantic.length > 0) {
    throw new ValidationError(
      `semantic validation reported ${fatalSemantic.length} error(s)`,
      toValidationIssues(fatalSemantic),
    );
  }

  return {
    workspace,
    cv,
    presentation,
    resolvedPresentationId,
  };
}

function parseWorkspaceEnvelope(text: string): WorkspaceDocument {
  return parseEnvelope(workspaceDocumentSchema, text, 'workspace');
}

function parseEnvelope<T>(
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; issues?: Array<{ path: Array<string | number>; message: string }> } },
  text: string,
  label: string,
): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ValidationError(
      `${label}: failed to parse JSON (${(error as Error).message})`,
    );
  }
  const result = schema.safeParse(raw);
  if (!result.success || result.data === undefined) {
    const issues = result.issues ?? [];
    const first = issues[0];
    const path = first?.path?.join('.') ?? '';
    const message = first?.message ?? 'unknown Zod issue';
    throw new ValidationError(
      `${label}: schema validation failed at '${path}': ${message}`,
      issues.map((issue) => ({
        code: 'zod:' + issue.path.join('.'),
        message: issue.message,
        path: issue.path.join('.'),
      })),
    );
  }
  return result.data;
}

async function defaultRead(absPath: string): Promise<string> {
  return readFile(absPath, 'utf8');
}

function assertAbsolute(value: string, label: string): string {
  if (!isAbsolute(value)) {
    throw new ValidationError(`${label} must be an absolute path (got '${value}')`);
  }
  return value;
}

function toValidationIssues(
  semantic: readonly SemanticIssue[],
): readonly ValidationIssue[] {
  return semantic.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path ?? '',
  }));
}
