// DOM/HTML assembly. Pure string templates — no DOM library. The
// rendered output mirrors the structure described in the renderer
// contract:
//
//   <article class="seevee-page" data-page="N">
//     <section data-seevee-section="...">
//       <article data-seevee-item="..." data-seevee-item-type="...">
//         <span data-seevee-field="..." data-seevee-field-path="...">
//           Ada Lovelace
//         </span>
//         ...
//       </article>
//     </section>
//   </article>
//
// The renderer is responsible for stable `data-seevee-*` keys because
// the dashboard anchors comments and partial-rerender slots on those
// attributes. Names must not change without coordinating with the
// dashboard.

import type { CvEntity } from '@seevee/schema';
import type { SectionId } from '@seevee/template-sdk';

import type { PaginatorItem } from './read-model.js';
import type { PaginatedPage } from './pagination.js';
import type { ResolvedPageProfile } from './profile.js';

export interface RenderDocumentOptions {
  readonly title?: string;
  readonly extraHead?: string;
}

const ESCAPE_LOOKUP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Assemble a full HTML document from page fragments, the page-profile
 * CSS, and a small block of head content. The result is a single string
 * that contains the complete `<!doctype html>…</html>` envelope so
 * callers can drop it straight into a file or response.
 */
export function renderDocument(
  pages: readonly PaginatedPage[],
  profile: ResolvedPageProfile,
  options: RenderDocumentOptions = {},
): string {
  const title = escapeHtml(options.title ?? 'Seevee');
  const body = pages.map(renderPageFragment).join('\n');
  const extraHead = options.extraHead ?? '';
  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<title>${title}</title>\n` +
    `<style>\n${pageRuleCss(profile)}\n${BASE_CSS}\n</style>\n` +
    `${extraHead}\n` +
    `</head>\n` +
    `<body>\n${body}\n</body>\n` +
    `</html>\n`
  );
}

const BASE_CSS = [
  'body { font-family: \'Inter\', sans-serif; color: #111; }',
  '.seevee-page { page-break-after: always; }',
  '.seevee-page:last-of-type { page-break-after: auto; }',
  '.seevee-section { margin: 0 0 6mm 0; }',
  '.seevee-section-title { margin: 0 0 3mm 0; font-size: 14pt; font-weight: 600; }',
  '.seevee-item { margin: 0 0 3mm 0; }',
  '.seevee-divider { height: 1mm; background: #ddd; margin: 2mm 0; }',
  '[data-seevee-section] { display: block; }',
  '[data-seevee-item] { display: block; }',
  '[data-seevee-field] { display: inline; }',
].join('\n');

function pageRuleCss(profile: ResolvedPageProfile): string {
  const margin =
    `${profile.marginMm.top}mm ` +
    `${profile.marginMm.right}mm ` +
    `${profile.marginMm.bottom}mm ` +
    `${profile.marginMm.left}mm`;
  const size = `${formatMm(profile.widthMm)} ${formatMm(profile.heightMm)}`;
  return `@page { size: ${size}; margin: ${margin}; }\n` +
    `.seevee-page { width: ${formatMm(profile.widthMm)}; ` +
    `min-height: ${formatMm(profile.heightMm)}; }`;
}

function formatMm(mm: number): string {
  const trimmed = Number.parseFloat(mm.toFixed(4));
  return `${trimmed}mm`;
}

function renderPageFragment(page: PaginatedPage): string {
  const grouped = new Map<SectionId, PaginatorItem[]>();
  for (const item of page.items) {
    const bucket = grouped.get(item.sectionId);
    if (bucket === undefined) {
      grouped.set(item.sectionId, [item]);
    } else {
      bucket.push(item);
    }
  }
  const body = Array.from(grouped.entries())
    .map(([sectionId, items]) => renderSection(sectionId, items))
    .join('\n');
  return `<article class="seevee-page" data-page="${page.pageNumber}">\n${body}\n</article>`;
}

function renderSection(
  sectionId: SectionId,
  items: readonly PaginatorItem[],
): string {
  const heading = items.find((item) => item.kind === 'section-heading');
  const title = heading?.section.title ?? '';
  const attributes = `data-seevee-section="${escapeAttr(sectionId)}"`;
  const titleText = escapeHtml(title);
  const body = items
    .filter((item) => item.kind !== 'section-heading')
    .map(renderItem)
    .join('\n');
  return `<section ${attributes} data-seevee-section-title="${escapeAttr(titleText)}">` +
    `<h2 class="seevee-section-title">${titleText}</h2>\n${body}\n</section>`;
}

function renderItem(item: PaginatorItem): string {
  if (item.kind === 'divider') {
    return `<div class="seevee-divider" data-seevee-divider="${escapeAttr(item.sectionId)}"></div>`;
  }
  if (item.kind === 'section-heading') {
    // The heading itself is rendered by the section wrapper; standalone
    // heading items outside a section never occur in the paginated
    // output, but we still emit a stable anchor for completeness.
    return `<h3 class="seevee-section-heading" data-seevee-item="${escapeAttr(item.id)}"></h3>`;
  }
  if (item.entity === null) {
    return `<article data-seevee-item="${escapeAttr(item.id)}"></article>`;
  }
  return renderEntityItem(item);
}

function renderEntityItem(item: PaginatorItem): string {
  const entity = item.entity;
  if (entity === null) {
    return `<article data-seevee-item="${escapeAttr(item.id)}"></article>`;
  }
  const entityType = entity.type;
  const fields = entityFields(entity);
  const fieldMarkup = fields
    .map(({ path, value }) =>
      `<span data-seevee-field="${escapeAttr(path)}" data-seevee-field-path="${escapeAttr(path)}">${escapeHtml(value)}</span>`,
    )
    .join(' ');
  return (
    `<article data-seevee-item="${escapeAttr(item.id)}" ` +
    `data-seevee-item-type="${escapeAttr(entityType)}" data-seevee-section="${escapeAttr(item.sectionId)}">` +
    `${fieldMarkup}</article>`
  );
}

interface FieldRender {
  readonly path: string;
  readonly value: string;
}

function entityFields(entity: CvEntity): readonly FieldRender[] {
  switch (entity.type) {
    case 'experience': {
      return [
        { path: '/role/title', value: entity.role.title },
        { path: '/organization/name', value: entity.organization.name },
        { path: '/summary', value: entity.summary ?? '' },
      ];
    }
    case 'education': {
      return [
        { path: '/program/name', value: entity.program.name },
        { path: '/institution/name', value: entity.institution.name },
      ];
    }
    case 'project': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'skill': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'skill-group': {
      return [{ path: '/label', value: entity.label }];
    }
    case 'certification': {
      return [
        { path: '/name', value: entity.name },
        { path: '/issuer', value: entity.issuer },
      ];
    }
    case 'award': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'language': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'publication': {
      return [
        { path: '/title', value: entity.title },
        { path: '/authors', value: entity.authors.join(', ') },
      ];
    }
    case 'volunteering': {
      return [
        { path: '/role/title', value: entity.role.title },
        { path: '/organization/name', value: entity.organization.name },
      ];
    }
    case 'reference': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'organization': {
      return [{ path: '/name', value: entity.name }];
    }
    case 'role': {
      return [{ path: '/title', value: entity.title }];
    }
    case 'bullet-collection': {
      return [{ path: '/label', value: 'bullets' }];
    }
    case 'customEntity': {
      return [
        { path: '/label', value: entity.label },
        ...Object.entries(entity.data).map(([key, value]) => ({
          path: `/data/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value),
        })),
      ];
    }
    default: {
      return [{ path: '/id', value: '' }];
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_LOOKUP[ch] ?? ch);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
