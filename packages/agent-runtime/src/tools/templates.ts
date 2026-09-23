import { z } from 'zod';
import path from 'node:path';
import { mutationToolError } from '../executor.js';
import type { ToolDefinition } from '../types.js';

/**
 * Templates tools — read-only `templates.list` and `templates.readManifest`
 * return manifest documents; the remaining template tools are mutation
 * stubs (template-source edits must go through the review surface).
 */

const templatesListInput = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

const templatesListOutput = z
  .object({
    templates: z.array(
      z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
        currentVersionId: z.string().min(1),
      }),
    ),
  })
  .strict();

const templatesReadManifestInput = z
  .object({
    workspaceRoot: z.string().min(1),
    templateId: z.string().min(1),
  })
  .strict();

const templatesReadManifestOutput = z
  .object({
    document: z.record(z.unknown()),
    relativePath: z.string().min(1),
  })
  .strict();

const templatesReadSourceInput = z
  .object({
    workspaceRoot: z.string().min(1),
    templateId: z.string().min(1),
    filePath: z.string().min(1),
  })
  .strict();

const templatesReadSourceOutput = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();

const templatesCreateDraftInput = z
  .object({
    workspaceRoot: z.string().min(1),
    templateId: z.string().min(1),
    seed: z.record(z.unknown()).optional(),
  })
  .strict();

const templatesCreateDraftOutput = z
  .object({
    draftId: z.string().min(1),
  })
  .strict();

const templatesPatchDraftFileInput = z
  .object({
    workspaceRoot: z.string().min(1),
    draftId: z.string().min(1),
    filePath: z.string().min(1),
    content: z.string(),
  })
  .strict();

const templatesPatchDraftFileOutput = z
  .object({
    accepted: z.boolean(),
  })
  .strict();

const templatesValidateInput = z
  .object({
    workspaceRoot: z.string().min(1),
    draftId: z.string().min(1),
  })
  .strict();

const templatesValidateOutput = z
  .object({
    valid: z.boolean(),
    diagnostics: z.array(z.record(z.unknown())),
  })
  .strict();

const templatesCompileInput = templatesValidateInput;

const templatesCompileOutput = z
  .object({
    compiledPath: z.string().min(1),
  })
  .strict();

const templatesActivateInput = z
  .object({
    workspaceRoot: z.string().min(1),
    draftId: z.string().min(1),
  })
  .strict();

const templatesActivateOutput = z
  .object({
    activatedVersionId: z.string().min(1),
  })
  .strict();

async function readWorkspaceResources(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const workspaceRaw = await readFile(path.join(workspaceRoot, 'seevee.json'));
  const workspace = JSON.parse(workspaceRaw) as Record<string, unknown>;
  const data = (workspace['data'] as Record<string, unknown> | undefined) ?? {};
  return (data['resources'] as Record<string, unknown> | undefined) ?? {};
}

export const templatesListTool: ToolDefinition<typeof templatesListInput, typeof templatesListOutput> = {
  name: 'templates.list',
  description: 'List templates registered in the workspace.',
  input: templatesListInput,
  output: templatesListOutput,
  handler: async (input, ctx) => {
    const resources = await readWorkspaceResources(input.workspaceRoot, ctx.deps.readFile);
    const templates = (resources['templates'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    return {
      templates: Object.values(templates).map((entry) => ({
        id: String(entry['id'] ?? ''),
        relativePath: String(entry['relativePath'] ?? ''),
        currentVersionId: String(entry['currentVersionId'] ?? ''),
      })),
    };
  },
};

export const templatesReadManifestTool: ToolDefinition<
  typeof templatesReadManifestInput,
  typeof templatesReadManifestOutput
> = {
  name: 'templates.readManifest',
  description: 'Read a template manifest document.',
  input: templatesReadManifestInput,
  output: templatesReadManifestOutput,
  handler: async (input, ctx) => {
    const resources = await readWorkspaceResources(input.workspaceRoot, ctx.deps.readFile);
    const templates = (resources['templates'] as Record<string, Record<string, unknown>> | undefined) ?? {};
    const entry = templates[input.templateId];
    if (!entry) {
      throw new Error(`Template '${input.templateId}' not registered in workspace`);
    }
    const relativePath = String(entry['relativePath']);
    const absolute = path.join(input.workspaceRoot, relativePath);
    const raw = await ctx.deps.readFile(absolute);
    const document = JSON.parse(raw) as Record<string, unknown>;
    return { document, relativePath };
  },
};

export const templatesReadSourceTool: ToolDefinition<typeof templatesReadSourceInput, typeof templatesReadSourceOutput> = {
  name: 'templates.readSource',
  description: 'Read a template source file (after the manifest).',
  input: templatesReadSourceInput,
  output: templatesReadSourceOutput,
  handler: async (input, ctx) => {
    const absolute = path.join(input.workspaceRoot, 'templates', input.templateId, input.filePath);
    const content = await ctx.deps.readFile(absolute);
    return { path: input.filePath, content };
  },
};

export const templatesCreateDraftTool: ToolDefinition<
  typeof templatesCreateDraftInput,
  typeof templatesCreateDraftOutput
> = {
  name: 'templates.createDraft',
  description: 'Create a template draft (mutation — review required).',
  input: templatesCreateDraftInput,
  output: templatesCreateDraftOutput,
  handler: async () => {
    throw mutationToolError('templates.createDraft');
  },
};

export const templatesPatchDraftFileTool: ToolDefinition<
  typeof templatesPatchDraftFileInput,
  typeof templatesPatchDraftFileOutput
> = {
  name: 'templates.patchDraftFile',
  description: 'Patch a template draft file (mutation — review required).',
  input: templatesPatchDraftFileInput,
  output: templatesPatchDraftFileOutput,
  handler: async () => {
    throw mutationToolError('templates.patchDraftFile');
  },
};

export const templatesValidateTool: ToolDefinition<typeof templatesValidateInput, typeof templatesValidateOutput> = {
  name: 'templates.validate',
  description: 'Validate a template draft (mutation — review required).',
  input: templatesValidateInput,
  output: templatesValidateOutput,
  handler: async () => {
    throw mutationToolError('templates.validate');
  },
};

export const templatesCompileTool: ToolDefinition<typeof templatesCompileInput, typeof templatesCompileOutput> = {
  name: 'templates.compile',
  description: 'Compile a template draft (mutation — review required).',
  input: templatesCompileInput,
  output: templatesCompileOutput,
  handler: async () => {
    throw mutationToolError('templates.compile');
  },
};

export const templatesActivateTool: ToolDefinition<typeof templatesActivateInput, typeof templatesActivateOutput> = {
  name: 'templates.activate',
  description: 'Activate a template draft (mutation — review required).',
  input: templatesActivateInput,
  output: templatesActivateOutput,
  handler: async () => {
    throw mutationToolError('templates.activate');
  },
};

export const templatesTools = [
  templatesListTool,
  templatesReadManifestTool,
  templatesReadSourceTool,
  templatesCreateDraftTool,
  templatesPatchDraftFileTool,
  templatesValidateTool,
  templatesCompileTool,
  templatesActivateTool,
] as const;
