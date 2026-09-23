// Pagination. Walks the linear list of items produced by the read
// model and splits it into pages that respect:
//
//   - the page content-box height (mm);
//   - each item's `breakBehavior`:
//       - `avoid`        — never split; if it doesn't fit on the
//                          current page, force a page-before break and
//                          place the item whole on the next page.
//       - `split`        — never force a break; if the item overflows
//                          we surface overflow in the page diagnostic
//                          (we don't truncate content).
//       - `page-before`  — always start on a fresh page.
//       - `page-after`   — close the current page first, then continue.
//       - `auto`         — flow normally (the item may split).
//
// The renderer never hides overflow. When an item cannot fit even on
// its own page, we record it on the page's `PageDiagnostic` (via
// `evaluatePageLayout`) and still emit the content — downstream
// callers (PDF export) decide whether to fail closed or render with
// the overflow visually flagged.

import type { ItemId } from '@seevee/template-sdk';

import type { PaginatorItem } from './read-model.js';

export interface PaginatorOptions {
  readonly pageHeightMm: number;
  readonly maxPages?: number;
  readonly maxItemsPerPage?: number;
}

export interface PaginatedPage {
  readonly pageNumber: number;
  readonly items: readonly PaginatorItem[];
  readonly contentHeightMm: number;
}

export interface PaginationResult {
  readonly pages: readonly PaginatedPage[];
  readonly overflowByItem: Readonly<Record<ItemId, number>>;
  readonly unclippableOverflow: ReadonlyArray<{
    readonly itemId: ItemId;
    readonly overflowAmount: number;
  }>;
}

const MAX_PAGES_DEFAULT = 64;
const MAX_ITEMS_PER_PAGE_DEFAULT = 256;

/**
 * Paginate a list of paginator items into pages respecting each item's
 * break behavior. The result is deterministic: the same input list
 * always produces the same page boundaries.
 */
export function paginate(
  items: readonly PaginatorItem[],
  options: PaginatorOptions,
): PaginationResult {
  const maxPages = options.maxPages ?? MAX_PAGES_DEFAULT;
  const maxItemsPerPage = options.maxItemsPerPage ?? MAX_ITEMS_PER_PAGE_DEFAULT;
  const pageHeight = options.pageHeightMm;

  const pages: PaginatedPage[] = [];
  const overflowByItem: Record<ItemId, number> = {};
  const unclippableOverflow: { itemId: ItemId; overflowAmount: number }[] = [];

  let currentItems: PaginatorItem[] = [];
  let currentHeight = 0;
  let pageNumber = 1;

  const closePage = (): void => {
    pages.push(
      Object.freeze({
        pageNumber,
        items: Object.freeze([...currentItems]),
        contentHeightMm: currentHeight,
      }),
    );
    pageNumber += 1;
    currentItems = [];
    currentHeight = 0;
  };

  const capReached = (): boolean => pages.length >= maxPages;

  const forcePageBefore = (item: PaginatorItem): void => {
    if (currentItems.length > 0 && !capReached()) {
      closePage();
    }
    overflowByItem[item.id] = (overflowByItem[item.id] ?? 0) + Math.max(
      0,
      item.heightMm - pageHeight,
    );
    if (item.heightMm > pageHeight) {
      unclippableOverflow.push({
        itemId: item.id,
        overflowAmount: item.heightMm - pageHeight,
      });
    }
    // The item still gets emitted on the new page; we never silently
    // drop content. If the cap has been reached, the item still rides
    // on the current page and the diagnostic record carries the
    // overflow amount.
    currentItems.push(item);
    currentHeight += item.heightMm;
  };

  for (const item of items) {
    if (capReached() && currentItems.length === 0) {
      // We've already filled `maxPages` and there's no in-flight page
      // to attach the next item to. Record the overflow and stop.
      const overflow = item.heightMm;
      overflowByItem[item.id] = (overflowByItem[item.id] ?? 0) + overflow;
      unclippableOverflow.push({ itemId: item.id, overflowAmount: overflow });
      break;
    }

    if (currentItems.length >= maxItemsPerPage) {
      if (!capReached()) {
        closePage();
      } else {
        break;
      }
    }

    const fits = currentHeight + item.heightMm <= pageHeight;

    switch (item.breakBehavior) {
      case 'page-before': {
        forcePageBefore(item);
        break;
      }
      case 'page-after': {
        currentItems.push(item);
        currentHeight += item.heightMm;
        if (!capReached()) {
          closePage();
        }
        break;
      }
      case 'avoid': {
        if (!fits) {
          forcePageBefore(item);
        } else {
          currentItems.push(item);
          currentHeight += item.heightMm;
        }
        break;
      }
      case 'split':
      case 'auto':
      default: {
        if (!fits) {
          if (currentItems.length === 0) {
            currentItems.push(item);
            currentHeight += item.heightMm;
            overflowByItem[item.id] = item.heightMm - pageHeight;
            unclippableOverflow.push({
              itemId: item.id,
              overflowAmount: item.heightMm - pageHeight,
            });
            if (!capReached()) {
              closePage();
            }
          } else if (!capReached()) {
            closePage();
            currentItems.push(item);
            currentHeight += item.heightMm;
            if (item.heightMm > pageHeight) {
              overflowByItem[item.id] = item.heightMm - pageHeight;
              unclippableOverflow.push({
                itemId: item.id,
                overflowAmount: item.heightMm - pageHeight,
              });
            }
          } else {
            currentItems.push(item);
            currentHeight += item.heightMm;
            overflowByItem[item.id] =
              (overflowByItem[item.id] ?? 0) + item.heightMm;
          }
        } else {
          currentItems.push(item);
          currentHeight += item.heightMm;
        }
        break;
      }
    }
  }

  if (currentItems.length > 0 || pages.length === 0) {
    if (pages.length < maxPages) {
      pages.push(
        Object.freeze({
          pageNumber,
          items: Object.freeze([...currentItems]),
          contentHeightMm: currentHeight,
        }),
      );
    }
  }

  // Drop the leading empty page that can result from a forced
  // `page-before` for the very first item — it shouldn't appear before
  // any content has been placed.
  const compact = pages.filter(
    (page, index) => !(index === 0 && page.items.length === 0),
  );

  return Object.freeze({
    pages: Object.freeze(
      compact.map((page, index) =>
        Object.freeze({
          pageNumber: index + 1,
          items: page.items,
          contentHeightMm: page.contentHeightMm,
        }),
      ),
    ),
    overflowByItem: Object.freeze(overflowByItem),
    unclippableOverflow: Object.freeze(unclippableOverflow),
  });
}
