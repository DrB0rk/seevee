import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  allAgentTools,
  runTool,
  defineTools,
} from '../src/index.js';
import { cvCreateTool, cvDuplicateTool, cvProposeChangesTool } from '../src/tools/cv.js';
import { workspacePutTool } from '../src/tools/workspace.js';
import { commentsSetWorkStateTool } from '../src/tools/comments.js';
import { renderPreviewTool, renderInspectLayoutTool, exportPdfTool } from '../src/tools/export.js';
import type { RoleDeps, ToolDefinition, ToolRegistry } from '../src/types.js';

const MIN_TOOLS = 30;

type AnyRegistry = ToolRegistry<Record<string, ToolDefinition<z.ZodTypeAny, z.ZodTypeAny>>>;

async function makeTmpWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-agent-runtime-'));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const WORKSPACE_FIXTURE = {
  kind: 'seevee.workspace',
  schemaVersion: '1.0.0',
  id: 'ws_main',
  revision: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    name: 'Test Workspace',
    active: { cvId: 'cv_main' },
    policy: {
      allowAgentFactInference: false,
      requireEvidenceForNumericClaims: true,
      allowForceExportWithOverflow: false,
    },
    resources: {
      cvs: {
        cv_main: {
          id: 'cv_main',
          relativePath: 'cvs/cv_main.json',
          revision: 5,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      presentations: {
        pres_main: {
          id: 'pres_main',
          relativePath: 'presentations/pres_main.json',
          templateId: 'tpl_minimal',
          versionId: 'tpl_minimal_v1',
          revision: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      provenance: {
        prov_main: {
          id: 'prov_main',
          relativePath: 'provenance/main.json',
          cvId: 'cv_main',
          revision: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      comments: {
        comments_main: {
          id: 'comments_main',
          relativePath: 'comments/main.json',
          cvId: 'cv_main',
          revision: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      sources: {
        src_resume: {
          id: 'src_resume',
          relativePath: 'sources/extracted/src_resume.json',
          type: 'source',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      templates: {
        tpl_minimal: {
          id: 'tpl_minimal',
          relativePath: 'templates/local/tpl_minimal/manifest.json',
          currentVersionId: 'tpl_minimal_v1',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      stylePresets: {},
      changeSets: {},
      agentRuns: {},
    },
    extensions: {},
  },
};

const CV_FIXTURE = {
  kind: 'seevee.cv',
  schemaVersion: '1.0.0',
  id: 'cv_main',
  revision: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    locale: 'en-US',
    identity: {
      id: 'person_main',
      name: { display: 'Ada Lovelace' },
      contact: [{ kind: 'email', value: 'ada@example.com' }],
    },
    sectionOrder: ['sec_summary'],
    sections: {
      sec_summary: {
        id: 'sec_summary',
        type: 'summary',
        title: 'Summary',
        visible: true,
        collapsible: false,
      },
    },
    entities: {},
  },
};

const PROVENANCE_FIXTURE = {
  kind: 'seevee.provenance',
  schemaVersion: '1.0.0',
  id: 'prov_main',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: { sources: {}, assertions: {} },
};

const COMMENTS_FIXTURE = {
  kind: 'seevee.comments',
  schemaVersion: '1.0.0',
  id: 'comments_main',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: { threads: {} },
};

const SOURCE_FIXTURE = {
  kind: 'seevee.source',
  schemaVersion: '1.0.0',
  id: 'src_resume',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    origin: {
      id: 'origin_resume',
      type: 'plaintext',
      name: 'resume.txt',
      contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      ingestedAt: '2026-01-01T00:00:00.000Z',
      metadata: {},
    },
    extraction: { adaptedAt: '2026-01-01T00:00:00.000Z', adapter: 'plaintext-extractor' },
    blocks: {},
  },
};

const TEMPLATE_MANIFEST_FIXTURE = {
  kind: 'seevee.template-manifest',
  schemaVersion: '1.0.0',
  id: 'tpl_minimal',
  capabilities: {
    multiPage: true,
    customPageSize: false,
    comments: false,
    twoColumn: false,
  },
  tokens: {},
  bindings: {},
};

const PRESENTATION_FIXTURE = {
  kind: 'seevee.presentation',
  schemaVersion: '1.0.0',
  id: 'pres_main',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    cvId: 'cv_main',
    template: { templateId: 'tpl_minimal', versionId: 'tpl_minimal_v1' },
    page: { preset: 'A4', orientation: 'portrait' },
    pagination: {},
    tokens: {},
    sectionOverrides: {},
    templateOverrides: {},
  },
};

async function seed(workspaceRoot: string): Promise<void> {
  await writeJson(path.join(workspaceRoot, 'seevee.json'), WORKSPACE_FIXTURE);
  await writeJson(path.join(workspaceRoot, 'cvs/cv_main.json'), CV_FIXTURE);
  await writeJson(path.join(workspaceRoot, 'provenance/main.json'), PROVENANCE_FIXTURE);
  await writeJson(path.join(workspaceRoot, 'comments/main.json'), COMMENTS_FIXTURE);
  await writeJson(path.join(workspaceRoot, 'sources/extracted/src_resume.json'), SOURCE_FIXTURE);
  await writeJson(
    path.join(workspaceRoot, 'templates/local/tpl_minimal/manifest.json'),
    TEMPLATE_MANIFEST_FIXTURE,
  );
  await writeJson(path.join(workspaceRoot, 'presentations/pres_main.json'), PRESENTATION_FIXTURE);
}

function makeDeps(workspaceRoot: string): RoleDeps {
  return {
    readFile: async (target: string) => {
      const absolute = path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
      return await fs.readFile(absolute, 'utf8');
    },
    writeFile: async (target: string, content: string) => {
      const absolute = path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content);
    },
    listFiles: async (pattern: string) => {
      const absolute = path.isAbsolute(pattern) ? pattern : path.join(workspaceRoot, pattern);
      const dir = path.dirname(absolute);
      const base = path.basename(absolute);
      try {
        const entries = await fs.readdir(dir);
        return entries.filter((name) => name === base).map((name) => path.join(dir, name));
      } catch {
        return [];
      }
    },
    randomId: () => 'run_tool_test',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    toolRegistry: allAgentTools as unknown as AnyRegistry,
  };
}

describe('tool registry', () => {
  test('registers at least 30 tools', () => {
    expect(allAgentTools.names.length).toBeGreaterThanOrEqual(MIN_TOOLS);
  });

  test('includes every canonical §3 tool name', () => {
    const required = [
      'workspace.get',
      'cv.list',
      'cv.get',
      'provenance.get',
      'presentation.list',
      'presentation.get',
      'comments.list',
      'comments.get',
      'sources.list',
      'sources.readExtract',
      'templates.list',
      'templates.readManifest',
      'history.list',
      'cv.create',
      'cv.duplicate',
      'cv.proposeChanges',
      'presentation.create',
      'presentation.proposeChanges',
      'comments.setWorkState',
      'templates.readSource',
      'templates.createDraft',
      'templates.patchDraftFile',
      'templates.validate',
      'templates.compile',
      'templates.activate',
      'render.preview',
      'render.inspectLayout',
      'export.pdf',
      'workspace.put',
    ];
    for (const name of required) {
      expect(allAgentTools.definitions[name], `expected tool '${name}' registered`).toBeDefined();
    }
  });
});

describe('read tools round-trip against a fixture workspace', () => {
  test('workspace.get returns the seeded document and matches its revision', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type WorkspaceGetOutput = {
      document: Record<string, unknown>;
      relativePath: string;
      revision: number;
    };
    const result = await runTool(
      allAgentTools,
      'workspace.get',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x', baseRevision: 3 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.revision).toBe(3);
      expect(result.output.document['id']).toBe('ws_main');
    }
  });

  test('workspace.list returns cvs/presentation/templates/sources keys', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type WorkspaceListOutput = {
      cvs: string[];
      presentations: string[];
      templates: string[];
      sources: string[];
    };
    const result = await runTool(
      allAgentTools,
      'workspace.list',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.cvs).toContain('cv_main');
      expect(result.output.presentations).toContain('pres_main');
      expect(result.output.templates).toContain('tpl_minimal');
      expect(result.output.sources).toContain('src_resume');
    }
  });

  test('cv.list returns CV entries with revision', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type CvListOutput = { cvs: Array<{ id: string; revision: number }> };
    const result = await runTool(
      allAgentTools,
      'cv.list',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.cvs).toEqual([expect.objectContaining({ id: 'cv_main', revision: 5 })]);
    }
  });

  test('cv.get returns the CV document and revision', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type CvGetOutput = {
      document: Record<string, unknown>;
      relativePath: string;
      revision: number;
    };
    const result = await runTool(
      allAgentTools,
      'cv.get',
      { workspaceRoot: root, cvId: 'cv_main' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x', baseRevision: 5 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.revision).toBe(5);
      expect(result.output.document['id']).toBe('cv_main');
    }
  });

  test('presentation.get returns the presentation document', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'presentation.get',
      { workspaceRoot: root, presentationId: 'pres_main' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('provenance.get returns the provenance document', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'provenance.get',
      { workspaceRoot: root, cvId: 'cv_main' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('comments.list returns empty threads list when none registered', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type CommentsListOutput = { threads: unknown[]; relativePath: string };
    const result = await runTool(
      allAgentTools,
      'comments.list',
      { workspaceRoot: root, cvId: 'cv_main' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.threads).toEqual([]);
    }
  });

  test('comments.get returns the comments document', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'comments.get',
      { workspaceRoot: root, cvId: 'cv_main', threadId: 'thread_x' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('sources.list returns registered source ids', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type SourcesListOutput = { sources: Array<{ id: string }> };
    const result = await runTool(
      allAgentTools,
      'sources.list',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.sources.map((s: { id: string }) => s.id)).toContain('src_resume');
    }
  });

  test('sources.readExtract returns the extracted source document', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'sources.readExtract',
      { workspaceRoot: root, sourceId: 'src_resume' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('templates.list returns registered templates', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'templates.list',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('templates.readManifest returns the manifest document', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const result = await runTool(
      allAgentTools,
      'templates.readManifest',
      { workspaceRoot: root, templateId: 'tpl_minimal' },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
  });

  test('history.list returns runs (empty when none persisted yet)', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    type HistoryListOutput = { runs: unknown[] };
    const result = await runTool(
      allAgentTools,
      'history.list',
      { workspaceRoot: root },
      { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.output.runs)).toBe(true);
    }
  });
});

describe('mutation tools', () => {
  test('cv.create throws the mutation-tool error', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    await expect(
      runTool(
        allAgentTools,
        'cv.create',
        { workspaceRoot: root, cvId: 'cv_new' },
        { deps: makeDeps(root), workspaceRoot: root, runId: 'run_x' },
      ),
    ).rejects.toThrow(/mutation tool requires review: cv\.create/);
  });

  test('cv.duplicate, cv.proposeChanges, workspace.put, comments.setWorkState, render.preview, export.pdf all refuse', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const cases: Array<{ name: string; input: unknown }> = [
      { name: 'cv.duplicate', input: { workspaceRoot: root, cvId: 'cv_dup', sourceCvId: 'cv_main' } },
      {
        name: 'cv.proposeChanges',
        input: { workspaceRoot: root, cvId: 'cv_main', baseRevision: 5, operations: [{ op: 'noop' }] },
      },
      { name: 'workspace.put', input: { workspaceRoot: root, document: {}, baseRevision: 1 } },
      {
        name: 'comments.setWorkState',
        input: { workspaceRoot: root, cvId: 'cv_main', threadId: 't1', workState: 'in-progress' },
      },
      {
        name: 'render.preview',
        input: { workspaceRoot: root, cvId: 'cv_main', presentationId: 'pres_main' },
      },
      {
        name: 'export.pdf',
        input: { workspaceRoot: root, cvId: 'cv_main', presentationId: 'pres_main' },
      },
    ];
    for (const entry of cases) {
      await expect(
        runTool(allAgentTools, entry.name, entry.input, {
          deps: makeDeps(root),
          workspaceRoot: root,
          runId: 'run_x',
        }),
      ).rejects.toThrow(new RegExp(`mutation tool requires review: ${entry.name.replace('.', '\\.')}`));
    }
  });
});

describe('tool exports surface', () => {
  test('cv tools are individually exported', () => {
    expect(cvCreateTool.name).toBe('cv.create');
    expect(cvDuplicateTool.name).toBe('cv.duplicate');
    expect(cvProposeChangesTool.name).toBe('cv.proposeChanges');
  });

  test('workspace tools are individually exported', () => {
    expect(workspacePutTool.name).toBe('workspace.put');
  });

  test('comment tools are individually exported', () => {
    expect(commentsSetWorkStateTool.name).toBe('comments.setWorkState');
  });

  test('export tools are individually exported', () => {
    expect(renderPreviewTool.name).toBe('render.preview');
    expect(renderInspectLayoutTool.name).toBe('render.inspectLayout');
    expect(exportPdfTool.name).toBe('export.pdf');
  });

  test('defineTools returns a registry usable with runTool', () => {
    const registry = defineTools({ 'cv.list': cvCreateTool });
    expect(registry.definitions['cv.list'].name).toBe('cv.create');
  });
});
