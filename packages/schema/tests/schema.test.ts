/**
 * Schema contract tests — structural validation, semantic validation, and
 * migration framework.
 */

import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cvDocumentSchema,
  workspaceDocumentSchema,
  commentsDocumentSchema,
  provenanceDocumentSchema,
  presentationDocumentSchema,
  sourceDocumentSchema,
  changeSetDocumentSchema,
  templateManifestDocumentSchema,
  stylePresetDocumentSchema,
  agentRunDocumentSchema,
  renderDiagnosticsDocumentSchema,
  type CvDocument,
  type WorkspaceDocument,
} from '../src/index.js';

import {
  compareSemVer,
  latestVersion,
  planMigration,
  migrateDocument,
  type MigrationChain,
  type SemVer,
} from '../src/migrations/index.js';

import {
  validateWorkspaceSemantics,
} from '../src/semantic/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Structural validation — positive fixtures from tests/fixtures/*.json
// ---------------------------------------------------------------------------

test('cv-fixture parses as valid CV', () => {
  const result = cvDocumentSchema.safeParse(loadFixture('cv-fixture.json'));
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
});

test('cv rejects unknown kind literal', () => {
  const raw = { ...loadFixture('cv-fixture.json'), kind: 'seevee.unknown' };
  expect(cvDocumentSchema.safeParse(raw).success).toBe(false);
});

test('cv rejects missing required fields', () => {
  const raw = { kind: 'seevee.cv', id: 'x' };
  expect(cvDocumentSchema.safeParse(raw).success).toBe(false);
});

test('workspace-fixture parses as valid workspace', () => {
  expect(workspaceDocumentSchema.safeParse(loadFixture('workspace-fixture.json')).success).toBe(true);
});

test('workspace rejects wrong resource map type', () => {
  const raw = loadFixture('workspace-fixture.json');
  (raw as { data: { resources: Record<string, unknown> } }).data.resources.cvs = 'not-a-map';
  expect(workspaceDocumentSchema.safeParse(raw).success).toBe(false);
});

test('comments-fixture parses as valid comments', () => {
  expect(commentsDocumentSchema.safeParse(loadFixture('comments-fixture.json')).success).toBe(true);
});

test('comments thread requires priority enum value', () => {
  const raw = loadFixture('comments-fixture.json');
  (raw as { data: { threads: Record<string, { priority: string }> } }).data.threads.thr_1.priority = 'not-a-priority';
  expect(commentsDocumentSchema.safeParse(raw).success).toBe(false);
});

test('provenance-fixture parses as valid provenance', () => {
  expect(provenanceDocumentSchema.safeParse(loadFixture('provenance-fixture.json')).success).toBe(true);
});

test('presentation-fixture parses as valid presentation', () => {
  expect(presentationDocumentSchema.safeParse(loadFixture('presentation-fixture.json')).success).toBe(true);
});

test('token value rejects invalid color hex', () => {
  const raw = loadFixture('presentation-fixture.json');
  (raw as { data: { tokens: Record<string, unknown> } }).data.tokens.bad_color = { type: 'color', value: 'not-a-hex' };
  expect(presentationDocumentSchema.safeParse(raw).success).toBe(false);
});

test('source-fixture parses as valid source', () => {
  expect(sourceDocumentSchema.safeParse(loadFixture('source-fixture.json')).success).toBe(true);
});

test('source origin requires sha256 content hash format', () => {
  const raw = loadFixture('source-fixture.json');
  (raw as { data: { origin: { contentHash: string } } }).data.origin.contentHash = 'md5:abc';
  expect(sourceDocumentSchema.safeParse(raw).success).toBe(false);
});

test('change-set-fixture parses as valid change-set', () => {
  expect(changeSetDocumentSchema.safeParse(loadFixture('change-set-fixture.json')).success).toBe(true);
});

test('change-set operations discriminated union', () => {
  const raw = loadFixture('change-set-fixture.json');
  (raw as { operations: unknown[] }).operations = [
    { op: 'field.set', target: { nodeId: 'person_main', field: '/x' }, value: 1 },
    { op: 'node.remove', nodeId: 'node_two' },
  ];
  expect(changeSetDocumentSchema.safeParse(raw).success).toBe(true);
});

test('change-set rejects unknown op discriminator', () => {
  const raw = loadFixture('change-set-fixture.json');
  (raw as { operations: unknown[] }).operations = [{ op: 'teleport.node', nodeId: 'n1' }];
  expect(changeSetDocumentSchema.safeParse(raw).success).toBe(false);
});

test('template-manifest-fixture parses as valid manifest', () => {
  expect(templateManifestDocumentSchema.safeParse(loadFixture('template-manifest-fixture.json')).success).toBe(true);
});

test('template manifest requires astro engine', () => {
  const raw = loadFixture('template-manifest-fixture.json');
  (raw as { engine: string }).engine = 'react';
  expect(templateManifestDocumentSchema.safeParse(raw).success).toBe(false);
});

test('style-preset-fixture parses as valid style preset', () => {
  expect(stylePresetDocumentSchema.safeParse(loadFixture('style-preset-fixture.json')).success).toBe(true);
});

test('agent-run-fixture parses as valid agent run', () => {
  expect(agentRunDocumentSchema.safeParse(loadFixture('agent-run-fixture.json')).success).toBe(true);
});

test('agent-run rejects unknown state', () => {
  const raw = loadFixture('agent-run-fixture.json');
  (raw as { state: string }).state = 'paused';
  expect(agentRunDocumentSchema.safeParse(raw).success).toBe(false);
});

test('render-diagnostics-fixture parses as valid render diagnostics', () => {
  expect(renderDiagnosticsDocumentSchema.safeParse(loadFixture('render-diagnostics-fixture.json')).success).toBe(true);
});

// ---------------------------------------------------------------------------
// Semantic validation
// ---------------------------------------------------------------------------

test('semantic validator: dangling technologyRef', () => {
  const cv = minimalCv('cv1', [
    {
      id: 'exp1',
      type: 'experience',
      organization: { id: 'org1', type: 'organization', name: 'Acme' },
      role: { id: 'role1', type: 'role', title: 'Dev' },
      period: { start: { precision: 'year', year: 2020 } },
      bulletOrder: [],
      bullets: {},
      technologyRefs: ['skill_missing'],
    },
  ]);
  const issues = validateWorkspaceSemantics({ cv });
  const dangling = issues.filter((i) => i.code === 'cv.technologyRefs.dangling');
  expect(dangling).toHaveLength(1);
  expect(dangling[0].relatedId).toBe('skill_missing');
});

test('semantic validator: sectionOrder dangling', () => {
  const cv = minimalCv('cv2', []);
  cv.data.sectionOrder = ['nonexistent_section'];
  const issues = validateWorkspaceSemantics({ cv });
  const dangling = issues.filter((i) => i.code === 'cv.sectionOrder.dangling');
  expect(dangling).toHaveLength(1);
  expect(dangling[0].relatedId).toBe('nonexistent_section');
});

test('semantic validator: clean CV reports no issues', () => {
  const issues = validateWorkspaceSemantics({ cv: minimalCv('cv3', []) });
  expect(issues).toHaveLength(0);
});

test('semantic validator: bulletOrder dangling in project', () => {
  const cv = minimalCv('cv4', []);
  cv.data.sections = {
    sec1: { id: 'sec1', type: 'summary', title: 'S', visible: true, collapsible: false, defaultCollapsed: false },
  };
  cv.data.sectionOrder = ['sec1'];
  cv.data.entities = {
    projects: {
      proj1: {
        id: 'proj1',
        type: 'project',
        name: 'My Project',
        linkRefs: [],
        bulletOrder: ['bul_missing'],
        bullets: {},
        technologyRefs: [],
      },
    },
  };
  const issues = validateWorkspaceSemantics({ cv });
  const dangling = issues.filter((i) => i.code === 'cv.bulletOrder.dangling');
  expect(dangling).toHaveLength(1);
});

test('semantic validator: workspace revisionMismatch', () => {
  const ws = minimalWorkspace();
  ws.data.resources.cvs['cv_x'] = { id: 'cv_x', relativePath: 'x.json', revision: 5, updatedAt: '2026-01-01T00:00:00.000Z' };
  const cv = minimalCv('cv_x', []);
  cv.revision = 3;
  const issues = validateWorkspaceSemantics({ cv, workspace: ws });
  const mismatches = issues.filter((i) => i.code === 'workspace.cvRevisionMismatch');
  expect(mismatches).toHaveLength(1);
});

test('semantic validator: comments dangling nodeSelector', () => {
  const cv = minimalCv('cv5', []);
  const raw = loadFixture('comments-fixture.json');
  (raw as { data: { threads: { thr_1: { target: { selectors: Array<{ type: string; nodeId: string; nodeType: string }> } } } } }).data.threads.thr_1.target.selectors = [
    { type: 'NodeSelector', nodeId: 'ghost_node', nodeType: 'experience' },
  ];
  const issues = validateWorkspaceSemantics({ cv, comments: raw as Parameters<typeof validateWorkspaceSemantics>[0]['comments'] });
  const dangling = issues.filter((i) => i.code === 'comments.target.dangling');
  expect(dangling).toHaveLength(1);
  expect(dangling[0].relatedId).toBe('ghost_node');
});

test('semantic validator: provenance dangling nodeId', () => {
  const cv = minimalCv('cv6', []);
  const prov = {
    kind: 'seevee.provenance',
    schemaVersion: '1.0.0',
    id: 'prov1',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      sources: {},
      assertions: {
        a1: {
          id: 'a1',
          target: { nodeId: 'phantom' },
          evidence: [],
          claimType: 'direct',
          confidence: 'high',
          verifiedByUser: true,
        },
      },
    },
  };
  const issues = validateWorkspaceSemantics({ cv, provenance: prov });
  const dangling = issues.filter((i) => i.code === 'provenance.target.dangling');
  expect(dangling).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Migration framework
// ---------------------------------------------------------------------------

test('compareSemVer: ordering', () => {
  expect(compareSemVer('1.0.0', '1.0.0')).toBe(0);
  expect(compareSemVer('1.0.0', '1.0.1')).toBeLessThan(0);
  expect(compareSemVer('2.0.0', '1.9.9')).toBeGreaterThan(0);
  expect(compareSemVer('1.10.0', '1.9.0')).toBeGreaterThan(0);
});

test('latestVersion: returns highest version in chain', () => {
  const chain = makeChain([
    { from: '1.0.0', to: '1.1.0' },
    { from: '1.1.0', to: '2.0.0' },
  ]);
  expect(latestVersion(chain)).toBe('2.0.0');
});

test('planMigration: returns correct step sequence', () => {
  const chain = makeChain([
    { from: '1.0.0', to: '1.1.0' },
    { from: '1.1.0', to: '2.0.0' },
  ]);
  const path = planMigration(chain, '1.0.0');
  expect(path).toHaveLength(2);
  expect(path[0].from).toBe('1.0.0');
  expect(path[1].from).toBe('1.1.0');
});

test('planMigration: no path when already at latest', () => {
  expect(planMigration(makeChain([{ from: '1.0.0', to: '1.1.0' }]), '1.1.0')).toHaveLength(0);
});

test('planMigration: no path from unknown version', () => {
  expect(planMigration(makeChain([{ from: '1.0.0', to: '1.1.0' }]), '0.9.0')).toHaveLength(0);
});

test('migrateDocument: no-op when already at latest', () => {
  const chain = makeChain([{ from: '1.0.0', to: '1.1.0' }]);
  const doc = { schemaVersion: '1.1.0' as SemVer, id: 'd1' };
  const result = migrateDocument(chain, doc);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.applied).toBe(0);
});

test('migrateDocument: applies both steps', () => {
  const chain = makeChain([
    { from: '1.0.0', to: '1.1.0' },
    { from: '1.1.0', to: '2.0.0' },
  ]);
  const doc = { schemaVersion: '1.0.0' as SemVer, id: 'd1' };
  const result = migrateDocument(chain, doc);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.applied).toBe(2);
    expect(result.doc.schemaVersion).toBe('2.0.0');
  }
});

test('migrateDocument: gap in chain walks as far as possible', () => {
  const chain = makeChain([
    { from: '1.0.0', to: '1.1.0' },
    { from: '2.0.0', to: '2.1.0' },
  ]);
  const doc = { schemaVersion: '1.0.0' as SemVer, id: 'd1' };
  const result = migrateDocument(chain, doc);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.applied).toBe(1);
    expect(result.doc.schemaVersion).toBe('1.1.0');
  }
});

test('migrateDocument: warnings are collected', () => {
  const chain: MigrationChain = {
    kind: 'seevee.test',
    steps: [{
      from: '1.0.0',
      to: '1.1.0',
      summary: 'rename field x to y',
      migrate: (doc) => ({
        doc: { ...(doc as Record<string, unknown>), y: (doc as Record<string, unknown>).x },
        warnings: [{ code: 'field.renamed', message: 'x was renamed to y', path: '/x' }],
      }),
    }],
  };
  const doc = { schemaVersion: '1.0.0' as SemVer, id: 'd1', x: 42 };
  const result = migrateDocument(chain, doc);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.report[0].warnings).toHaveLength(1);
    expect(result.report[0].warnings[0].code).toBe('field.renamed');
    expect(result.doc.y).toBe(42);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalCv(id: string, experience: object[]): CvDocument {
  return {
    kind: 'seevee.cv',
    schemaVersion: '1.0.0',
    id,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      locale: 'en-US',
      identity: { id: 'person_' + id, name: { display: 'Test' }, contact: [] },
      sectionOrder: [],
      sections: {},
      entities: {
        experience: Object.fromEntries(experience.map((e) => [(e as { id: string }).id, e])),
      },
    },
  } as CvDocument;
}

function minimalWorkspace(): WorkspaceDocument {
  return {
    kind: 'seevee.workspace',
    schemaVersion: '1.0.0',
    id: 'ws1',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      name: 'Test Workspace',
      active: { cvId: 'cv1', presentationId: 'pres1' },
      policy: {
        allowAgentFactInference: false,
        requireEvidenceForNumericClaims: true,
        allowForceExportWithOverflow: false,
        autoResolveDeterministicComments: false,
      },
      resources: {
        cvs: { cv1: { id: 'cv1', relativePath: 'cvs/cv1.json', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' } },
        presentations: {},
        provenance: {},
        comments: {},
        sources: {},
        templates: {},
        stylePresets: {},
        changeSets: {},
        agentRuns: {},
      },
    },
  } as WorkspaceDocument;
}

function makeChain(steps: Array<{ from: SemVer; to: SemVer }>): MigrationChain {
  return {
    kind: 'seevee.test',
    steps: steps.map((s) => ({
      from: s.from,
      to: s.to,
      summary: s.from + ' to ' + s.to,
      migrate: (doc) => ({ doc: { ...(doc as Record<string, unknown>), schemaVersion: s.to }, warnings: [] }),
    })),
  };
}
