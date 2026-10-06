import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatWorkspaceContext, readWorkspaceContext } from '../src/control/workspace-context.js';
import {
  WORKSPACE_AGENT_SKILL_ENTRY,
  WORKSPACE_GUIDE_PATH,
  WORKSPACE_OPERATING_BRIEFING,
} from '../src/control/workspace-briefing.js';

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
    expect(block).toContain('private, fresh snapshot of the active CV');
    expect(block).toContain('Read a registered file only when the current prompt needs detail');
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

describe('workspace operating briefing', () => {
  async function preamble(options: { resumed?: boolean } = {}): Promise<string> {
    await writeMarker(MARKER);
    return formatWorkspaceContext(await readWorkspaceContext(root), { resumed: options.resumed ?? false });
  }

  it('is injected into every session preamble, new or resumed', async () => {
    for (const resumed of [false, true]) {
      const block = await preamble({ resumed });
      expect(block).toContain('## How to work in this workspace');
      expect(block).toContain(WORKSPACE_OPERATING_BRIEFING);
    }
  });

  it('still carries the briefing when no workspace marker was found', () => {
    const block = formatWorkspaceContext(null, { resumed: false });
    expect(block).toContain('No Seevee workspace marker');
    expect(block).toContain(WORKSPACE_OPERATING_BRIEFING);
  });

  it('states the CLI-first rule and names commands that actually exist', async () => {
    const block = await preamble();
    expect(block).toContain('CLI first');
    expect(block).toContain('Do not hand-roll work a command already does');
    for (const command of [
      'seevee status --json',
      'seevee doctor --json',
      'seevee validate --json',
      'seevee comments list --json',
      'seevee export [--output <path>] [--json]',
      'seevee template list | draft | validate | compile | activate',
    ]) {
      expect(block).toContain(command);
    }
  });

  it('points at AGENTS.md and the skill by exact path', async () => {
    const block = await preamble();
    expect(block).toContain(`\`${WORKSPACE_GUIDE_PATH}\` in the workspace root`);
    expect(block).toContain(`\`${WORKSPACE_AGENT_SKILL_ENTRY}\``);
    expect(block).toContain('references/');
  });

  it('carries the hard rules that are expensive to violate', async () => {
    const block = await preamble();
    expect(block).toContain('Never invent employers, dates, degrees, technologies, certifications, metrics, achievements, links, or contact data');
    expect(block).toContain('Never identify a node by array index');
    expect(block).toContain('separate documents');
    expect(block).toContain('A4 portrait, 210 mm × 297 mm, is only the default page profile');
    expect(block).toContain('do not start a second dashboard');
    expect(block).toContain('baseRevision');
  });

  it('stays compact enough to inject on every prompt', () => {
    const words = WORKSPACE_OPERATING_BRIEFING.trim().split(/\s+/).length;
    expect(words).toBeLessThan(1_500);
    // Roughly 4 characters per token; a budget well under a tenth of the
    // standing agent instructions keeps the per-turn cost negligible.
    expect(WORKSPACE_OPERATING_BRIEFING.length).toBeLessThan(8_000);
  });

  it('separates state from rules so the state block points at the briefing', async () => {
    const block = await preamble();
    const briefingAt = block.indexOf('## How to work in this workspace');
    expect(briefingAt).toBeGreaterThan(block.indexOf('Active CV: cv_artist'));
    expect(block.slice(0, briefingAt)).toContain('does not forbid looking up how this workspace works');
    expect(block.slice(0, briefingAt)).toContain('Those rules are below');
  });
});
