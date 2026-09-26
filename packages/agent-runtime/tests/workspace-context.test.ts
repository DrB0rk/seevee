import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatWorkspaceContext, readWorkspaceContext } from '../src/control/workspace-context.js';

let root = '';

const MARKER = {
  kind: 'seevee.workspace',
  schemaVersion: '1.0.0',
  id: 'ws_ctx',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    name: 'Context workspace',
    active: { cvId: 'cv_artist', presentationId: 'pres_artist' },
    policy: {
      allowAgentFactInference: false,
      requireEvidenceForNumericClaims: true,
      allowForceExportWithOverflow: false,
      autoResolveDeterministicComments: false,
    },
    extensions: {},
    resources: {
      cvs: { cv_artist: {}, cv_older: {} },
      presentations: { pres_artist: {} },
      provenance: {},
      comments: {},
      sources: {},
      templates: { classic: { id: 'classic', relativePath: 'templates/classic/version1', currentVersionId: 'version1', updatedAt: '2026-01-01T00:00:00.000Z' } },
      stylePresets: {},
      changeSets: {},
      agentRuns: {},
    },
  },
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'seevee-ctx-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeMarker(value: unknown): Promise<void> {
  await fs.writeFile(path.join(root, 'seevee.json'), JSON.stringify(value, null, 2));
}

describe('workspace context preamble', () => {
  it('names the active document so the agent knows what "this CV" means', async () => {
    await writeMarker(MARKER);
    const context = await readWorkspaceContext(root);
    expect(context).toMatchObject({ activeCv: 'cv_artist', activePresentation: 'pres_artist' });
    const block = formatWorkspaceContext(context, { resumed: false });
    expect(block).toContain('Active CV: cv_artist');
    expect(block).toContain('Active presentation: pres_artist');
    expect(block).toContain('2 CV(s)');
    expect(block).toContain('read `cvs/<active CV>.json` before answering');
    expect(block).toContain('Do not say you have not read it without checking the file');
  });

  it('tells a new session it has no earlier conversation', async () => {
    await writeMarker(MARKER);
    const block = formatWorkspaceContext(await readWorkspaceContext(root), { resumed: false });
    expect(block).toContain('This is a new session');
    expect(block).toContain('exists only as files in this workspace');
  });

  it('tells a resumed session that history is available', async () => {
    await writeMarker(MARKER);
    const block = formatWorkspaceContext(await readWorkspaceContext(root), { resumed: true });
    expect(block).toContain('resumed an existing conversation');
    expect(block).not.toContain('This is a new session');
  });

  it('degrades honestly when there is no workspace marker', async () => {
    expect(await readWorkspaceContext(root)).toBeNull();
    const block = formatWorkspaceContext(null, { resumed: false });
    expect(block).toContain('No Seevee workspace marker');
  });

  it('reports no active document instead of guessing one', async () => {
    const marker = structuredClone(MARKER) as { data: { active: Record<string, unknown> } };
    marker.data.active = { cvId: null, presentationId: null };
    await writeMarker(marker);
    const block = formatWorkspaceContext(await readWorkspaceContext(root), { resumed: false });
    expect(block).toContain('Active CV: none set');
  });
});
