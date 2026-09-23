import { describe, expect, test } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  agentRunDocumentSchema,
  type AgentRunDocument,
} from '@seevee/schema';
import {
  allAgentTools,
  executeIngestionRole,
  runTool,
} from '../src/index.js';
import type { IngestionRoleInput, RoleDeps } from '../src/types.js';

async function makeTmpWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-ingest-'));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const WORKSPACE = {
  kind: 'seevee.workspace',
  schemaVersion: '1.0.0',
  id: 'ws_main',
  revision: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    name: 'Ingest WS',
    active: { cvId: 'cv_main', presentationId: 'pres_main' },
    policy: {
      allowAgentFactInference: false,
      requireEvidenceForNumericClaims: true,
      allowForceExportWithOverflow: false,
      autoResolveDeterministicComments: false,
    },
    resources: {
      cvs: { cv_main: { id: 'cv_main', relativePath: 'cvs/cv_main.json', revision: 4, updatedAt: '2026-01-01T00:00:00.000Z' } },
      presentations: {},
      provenance: {
        prov_main: {
          id: 'prov_main',
          relativePath: 'provenance/main.json',
          cvId: 'cv_main',
          revision: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      comments: {},
      sources: {
        src_resume: {
          id: 'src_resume',
          relativePath: 'sources/extracted/src_resume.json',
          type: 'source',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      templates: {},
      stylePresets: {},
      changeSets: {},
      agentRuns: {},
    },
  },
};

const CV_DOC = {
  kind: 'seevee.cv',
  schemaVersion: '1.0.0',
  id: 'cv_main',
  revision: 4,
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

const PROVENANCE = {
  kind: 'seevee.provenance',
  schemaVersion: '1.0.0',
  id: 'prov_main',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: { sources: {}, assertions: {} },
};

async function seed(workspaceRoot: string): Promise<void> {
  await writeJson(path.join(workspaceRoot, 'seevee.json'), WORKSPACE);
  await writeJson(path.join(workspaceRoot, 'cvs/cv_main.json'), CV_DOC);
  await writeJson(path.join(workspaceRoot, 'provenance/main.json'), PROVENANCE);
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
      try {
        const entries = await fs.readdir(dir);
        return entries.map((name) => path.join(dir, name));
      } catch {
        return [];
      }
    },
    randomId: () => 'run_ingest_test',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    toolRegistry: allAgentTools,
  };
}

describe('executeIngestionRole', () => {
  test('produces a schema-valid completed run with empty changeSetIds', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const input: IngestionRoleInput = {
      workspaceRoot: root,
      sourceBlockIds: ['src_resume'],
      candidateCvId: 'cv_main',
      actor: { kind: 'system' },
    };
    const result = await executeIngestionRole(input, makeDeps(root));

    expect(result.runRecord.state).toBe('completed');
    expect(result.runRecord.changeSetIds).toEqual([]);
    expect(result.runRecord.commentIds).toEqual([]);
    expect(result.blockedReason).toBeUndefined();

    const schemaCheck = result.runRecord.checks.find((c) => c.id === 'workspace-schema');
    expect(schemaCheck?.status).toBe('pass');
    const cvCheck = result.runRecord.checks.find((c) => c.id === 'cv-schema');
    expect(cvCheck?.status).toBe('pass');
    const semanticCheck = result.runRecord.checks.find((c) => c.id === 'semantic');
    expect(semanticCheck?.status).toBe('pass');

    // Schema-validate the produced run record.
    const parsed: AgentRunDocument = agentRunDocumentSchema.parse(result.runRecord);
    expect(parsed.id).toBe(result.runRecord.id);

    // Persisted run record is on disk.
    const historyFile = path.join(root, '.seevee', 'history', `${result.runRecord.id}.json`);
    const persistedRaw = await fs.readFile(historyFile, 'utf8');
    const persisted = agentRunDocumentSchema.parse(JSON.parse(persistedRaw));
    expect(persisted.id).toBe(result.runRecord.id);
    expect(persisted.state).toBe('completed');
  });

  test('blocks when source block ids are not registered', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const input: IngestionRoleInput = {
      workspaceRoot: root,
      sourceBlockIds: ['src_missing'],
      candidateCvId: 'cv_main',
    };
    const result = await executeIngestionRole(input, makeDeps(root));
    expect(result.blockedReason).toMatch(/not registered/);
    expect(result.runRecord.state).toBe('completed');
  });

  test('blocks when the CV id is unknown', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const input: IngestionRoleInput = {
      workspaceRoot: root,
      sourceBlockIds: [],
      candidateCvId: 'cv_does_not_exist',
    };
    const result = await executeIngestionRole(input, makeDeps(root));
    expect(result.blockedReason).toMatch(/cv\.get failed/);
  });

  test('records skipped provenance when none registered', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    // Remove the provenance registration.
    const wsRaw = await fs.readFile(path.join(root, 'seevee.json'), 'utf8');
    const ws = JSON.parse(wsRaw) as Record<string, unknown>;
    const wsData = ws['data'] as Record<string, unknown>;
    const wsResources = wsData['resources'] as Record<string, unknown>;
    wsResources['provenance'] = {};
    await fs.writeFile(path.join(root, 'seevee.json'), `${JSON.stringify(ws, null, 2)}\n`);
    const input: IngestionRoleInput = {
      workspaceRoot: root,
      sourceBlockIds: [],
      candidateCvId: 'cv_main',
    };
    const result = await executeIngestionRole(input, makeDeps(root));
    const provenanceCheck = result.runRecord.checks.find((c) => c.id === 'provenance-schema');
    expect(provenanceCheck?.status).toBe('skipped');
  });

  test('output is consumable by runTool(history.list) afterwards', async () => {
    const root = await makeTmpWorkspace();
    await seed(root);
    const input: IngestionRoleInput = {
      workspaceRoot: root,
      sourceBlockIds: [],
      candidateCvId: 'cv_main',
    };
    await executeIngestionRole(input, makeDeps(root));
    type HistoryListOutput = { runs: Array<{ state: string }> };
    const list = await runTool(allAgentTools, 'history.list', { workspaceRoot: root }, {
      deps: makeDeps(root),
      workspaceRoot: root,
      runId: 'run_x',
    });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.output.runs.length).toBeGreaterThanOrEqual(1);
      expect(list.output.runs[0]?.state).toBe('completed');
    }
  });
});
