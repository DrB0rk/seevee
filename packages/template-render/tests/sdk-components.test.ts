import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cvDocumentSchema } from '@seevee/schema';
import type { CvDocument, PageProfile } from '@seevee/schema';

import { invalidateTemplate, renderTemplateToHtml } from '../src/index.js';

// Slice A's proof: the SDK's four components are real Astro components, so
// they render through Astro's own compiler and server renderer. This test
// builds a throwaway template that uses nothing but `Page`, `Section`, `Item`,
// and `Field`, and asserts on the actual HTML they emit.
//
// Before the fix these components returned frozen descriptor objects
// (`{ __astro_element, tag, props }`) that Astro choked on, and `Field`
// never resolved its value.

const PROFILE: PageProfile = {
  preset: 'A4',
  orientation: 'landscape',
};

const CV: CvDocument = cvDocumentSchema.parse({
  kind: 'seevee.cv',
  schemaVersion: '1.0.0',
  id: 'cv_sdk_components',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    locale: 'en-US',
    identity: {
      id: 'person_sdk',
      name: { display: 'Katherine Johnson' },
      contact: [],
    },
    sectionOrder: ['sec_exp'],
    sections: {
      sec_exp: {
        id: 'sec_exp',
        type: 'experience',
        title: 'Experience',
        visible: true,
        collapsible: false,
        defaultCollapsed: false,
        nodeOrder: ['exp_nasa'],
      },
    },
    entities: {
      experience: {
        exp_nasa: {
          id: 'exp_nasa',
          type: 'experience',
          organization: { id: 'org_nasa', type: 'organization', name: 'NASA' },
          role: { id: 'role_math', type: 'role', title: 'Research Mathematician' },
          period: {
            start: { precision: 'year', year: 1953 },
            end: { precision: 'year', year: 1986 },
          },
          bulletOrder: [],
          bullets: {},
          technologyRefs: [],
        },
      },
    },
  },
});

const scratchRoots: string[] = [];

afterAll(async () => {
  await invalidateTemplate();
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * Render a template whose body is `markup`, written to a fresh template root.
 * `markup` is evaluated inside the template's script block, so it closes over
 * `cv` and can drive the SDK components directly.
 */
async function renderWithSdk(markup: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'seevee-sdk-'));
  scratchRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });

  writeFileSync(
    join(root, 'template.json'),
    JSON.stringify({
      kind: 'seevee.template-manifest',
      schemaVersion: '1.0.0',
      id: 'tplsdkcomponents0000000000001',
      templateId: 'sdkcomponents',
      name: 'SDK Components',
      version: '1.0.0',
      entry: 'src/Resume.astro',
      engine: 'astro',
      capabilities: {
        multiPage: false,
        customPageSize: false,
        comments: true,
        twoColumn: false,
      },
      supportedCvSchema: '1.0.0',
      supportedPresentationSchema: '1.0.0',
      tokens: {},
      bindings: {},
      extensions: {},
      designIntent: { sector: 'general', voice: 'minimal', constraints: [] },
    }),
    'utf8',
  );

  writeFileSync(
    join(root, 'src', 'Resume.astro'),
    [
      '---',
      "import { deriveCv } from '@seevee/template-sdk';",
      "import { Page, Section, Item, Field } from '@seevee/template-sdk/components';",
      'const cv = deriveCv(Astro.props.cv);',
      '---',
      '<Page profile={Astro.props.profile}>',
      markup,
      '</Page>',
      '',
    ].join('\n'),
    'utf8',
  );

  return renderTemplateToHtml({
    templateRoot: root,
    cv: CV,
    profile: PROFILE,
  });
}

describe('Page component', () => {
  it('renders the page anchors and its children', async () => {
    const html = await renderWithSdk('<p class="child">child content</p>');

    expect(html).toContain('data-seevee-page="true"');
    expect(html).toContain('data-seevee-page-preset="A4"');
    expect(html).toContain('data-seevee-page-orientation="landscape"');
    expect(html).toContain('child content');
  });

  it('renders no descriptor object', async () => {
    const html = await renderWithSdk('<span>x</span>');
    expect(html).not.toContain('__astro_element');
    expect(html).not.toContain('[object Object]');
  });
});

describe('Section component', () => {
  it('renders section metadata for a known section', async () => {
    const html = await renderWithSdk(
      '<Section cv={cv} sectionId="experience"><p>body</p></Section>',
    );

    expect(html).toContain('data-seevee-section="experience"');
    expect(html).toContain('data-seevee-section-title="Experience"');
    expect(html).toContain('data-seevee-section-type="experience"');
    expect(html).toContain('data-seevee-section-visible="true"');
    expect(html).toContain('>body</p>');
    expect(html).not.toContain('data-seevee-empty');
  });

  it('marks an unknown section as empty instead of throwing', async () => {
    const html = await renderWithSdk(
      '<Section cv={cv} sectionId="no-such-section"><p>body</p></Section>',
    );

    expect(html).toContain('data-seevee-section="no-such-section"');
    expect(html).toContain('data-seevee-empty="true"');
    expect(html).toContain('>body</p>');
  });
});

describe('Item component', () => {
  it('renders item metadata for a known entity', async () => {
    const html = await renderWithSdk(
      '<Item cv={cv} itemId="exp_nasa" sectionId="experience"><p>body</p></Item>',
    );

    expect(html).toContain('data-seevee-item="exp_nasa"');
    expect(html).toContain('data-seevee-section="experience"');
    expect(html).toContain('data-seevee-item-type="experience"');
    expect(html).not.toContain('data-seevee-empty');
  });

  it('marks an unknown item as empty instead of throwing', async () => {
    const html = await renderWithSdk('<Item cv={cv} itemId="nope"><p>body</p></Item>');

    expect(html).toContain('data-seevee-item="nope"');
    expect(html).toContain('data-seevee-empty="true"');
  });
});

describe('Field component', () => {
  it('resolves a nested value into the element text', async () => {
    const html = await renderWithSdk(
      '<Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/role/title" />',
    );

    expect(html).toContain('Research Mathematician');
    expect(html).toContain('data-seevee-field="/role/title"');
    expect(html).toContain('data-seevee-item="exp_nasa"');
    expect(html).toContain('data-seevee-field-path="/role/title"');
  });

  it('escapes the resolved value', async () => {
    const html = await renderWithSdk(
      '<Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/organization/name" />',
    );
    expect(html).toContain('>NASA</span>');
  });

  it('renders the fallback as content when the value is missing', async () => {
    const html = await renderWithSdk(
      '<Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/summary" fallback="No summary" />',
    );

    expect(html).toContain('>No summary</span>');
    // The fallback must never be stringified into an attribute.
    expect(html).not.toContain('data-seevee-fallback');
  });

  it('prefers the resolved value over the fallback', async () => {
    const html = await renderWithSdk(
      '<Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/organization/name" fallback="IGNORED" />',
    );

    expect(html).toContain('>NASA</span>');
    expect(html).not.toContain('IGNORED');
  });

  it('renders numeric field values', async () => {
    const html = await renderWithSdk(
      '<Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/period/start/year" />',
    );
    expect(html).toContain('>1953</span>');
  });
});

describe('component composition', () => {
  it('renders nested sections, items, and fields together', async () => {
    const html = await renderWithSdk(`
      <Section cv={cv} sectionId="experience">
        <h2>Experience</h2>
        <Item cv={cv} itemId="exp_nasa" sectionId="experience">
          <Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/role/title" />
          <Field cv={cv} itemId="exp_nasa" sectionId="experience" fieldPath="/organization/name" />
        </Item>
      </Section>
    `);

    expect(html).toContain('data-seevee-section="experience"');
    expect(html).toContain('data-seevee-item="exp_nasa"');
    expect(html).toContain('Research Mathematician');
    expect(html).toContain('NASA');
    expect(html).not.toContain('[object Object]');
  });
});