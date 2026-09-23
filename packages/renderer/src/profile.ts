// Page-profile resolution. The renderer accepts either a preset name
// (`A4`, `Letter`) or a fully-specified `Custom` profile. Every profile
// normalises to the same shape: width, height, and margin, all in
// millimetres. The contract here is deliberately small — the SDK's
// `evaluatePageLayout` is the only consumer that inspects the inner
// content box, so we just need to produce enough information to feed it.

import type { PageProfile } from '@seevee/schema';

export type ProfilePreset = 'A4' | 'Letter' | 'Custom';

export interface ResolvedPageProfile {
  readonly preset: ProfilePreset;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly marginMm: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

interface ProfileInput {
  readonly preset: ProfilePreset;
  readonly width?: number;
  readonly height?: number;
  readonly margins?: number;
  readonly orientation?: 'portrait' | 'landscape';
}

const A4 = { width: 210, height: 297 } as const;
const LETTER = { width: 215.9, height: 279.4 } as const;
const DEFAULT_MARGIN_MM = 12;
const MIN_DIMENSION_MM = 10;

function assertPositiveDimension(value: number, field: string): void {
  if (!Number.isFinite(value) || value < MIN_DIMENSION_MM) {
    throw new Error(
      `renderer.profile: ${field} must be >= ${MIN_DIMENSION_MM}mm (got ${value})`,
    );
  }
}

function assertNonNegativeMargin(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`renderer.profile: ${field} must be >= 0mm (got ${value})`);
  }
}

/**
 * Resolve a high-level profile descriptor into the renderer's internal
 * page-profile shape. The descriptor is either a preset name (`A4`,
 * `Letter`) or a `Custom` profile carrying width/height/margins in mm.
 * Orientation is honoured: a `landscape` profile swaps width and height.
 */
export function resolveProfile(input: ProfileInput): ResolvedPageProfile {
  const orientation = input.orientation ?? 'portrait';
  const margin = input.margins ?? DEFAULT_MARGIN_MM;
  assertNonNegativeMargin(margin, 'margins');

  if (input.preset === 'A4' || input.preset === 'Letter') {
    const base = input.preset === 'A4' ? A4 : LETTER;
    const width = orientation === 'landscape' ? base.height : base.width;
    const height = orientation === 'landscape' ? base.width : base.height;
    return {
      preset: input.preset,
      widthMm: width,
      heightMm: height,
      marginMm: { top: margin, right: margin, bottom: margin, left: margin },
    };
  }

  if (input.width === undefined || input.height === undefined) {
    throw new Error(
      `renderer.profile: Custom profile requires width and height (mm)`,
    );
  }
  assertPositiveDimension(input.width, 'width');
  assertPositiveDimension(input.height, 'height');

  const width = orientation === 'landscape' ? input.height : input.width;
  const height = orientation === 'landscape' ? input.width : input.height;
  return {
    preset: 'Custom',
    widthMm: width,
    heightMm: height,
    marginMm: { top: margin, right: margin, bottom: margin, left: margin },
  };
}

/**
 * Adapt a resolved renderer profile into the schema `PageProfile` shape
 * the SDK's `evaluatePageLayout` expects. The renderer never sets
 * `scale`, `edges`, or `orientation` overrides — the inner content box
 * is computed from the renderer's own margins.
 */
export function toSdkPageProfile(
  resolved: ResolvedPageProfile,
): PageProfile {
  const horizontalMargin = resolved.marginMm.left + resolved.marginMm.right;
  const verticalMargin = resolved.marginMm.top + resolved.marginMm.bottom;
  const sdkPreset: PageProfile['preset'] =
    resolved.preset === 'Custom' ? 'custom' : resolved.preset;

  return {
    preset: sdkPreset,
    orientation: 'portrait',
    width: resolved.widthMm,
    height: resolved.heightMm,
    edges: {
      top: resolved.marginMm.top,
      right: resolved.marginMm.right,
      bottom: resolved.marginMm.bottom,
      left: resolved.marginMm.left,
    },
    // Expose the residual content-box dimensions to the SDK via scale so
    // that it does not have to know about the renderer's margin model.
    // The inner content box ends up `width - horizontalMargin` wide and
    // `height - verticalMargin` tall; scaling by that ratio keeps the
    // SDK's `contentBoxMm` math honest while leaving the renderer's own
    // height bookkeeping untouched.
    scale: computeContentScale(resolved.widthMm, resolved.heightMm, horizontalMargin, verticalMargin),
  };
}

function computeContentScale(
  widthMm: number,
  heightMm: number,
  horizontalMargin: number,
  verticalMargin: number,
): number {
  const innerWidth = Math.max(1, widthMm - horizontalMargin);
  const innerHeight = Math.max(1, heightMm - verticalMargin);
  const sx = innerWidth / widthMm;
  const sy = innerHeight / heightMm;
  return Math.min(sx, sy);
}

/**
 * Render the `@page { size: …; margin: …; }` CSS rule for a resolved
 * profile. We always emit absolute (mm) units so the printer sees the
 * exact page dimensions rather than relying on locale-dependent name
 * resolution.
 */
export function pageCss(profile: ResolvedPageProfile): string {
  const margin =
    `${profile.marginMm.top}mm ` +
    `${profile.marginMm.right}mm ` +
    `${profile.marginMm.bottom}mm ` +
    `${profile.marginMm.left}mm`;
  return `@page { size: ${formatSize(profile.widthMm)} ${formatSize(profile.heightMm)}; margin: ${margin}; }`;
}

function formatSize(mm: number): string {
  // Trim trailing zeros for stable snapshots (e.g. 210 vs 210.0).
  const trimmed = Number.parseFloat(mm.toFixed(4));
  return `${trimmed}mm`;
}

/**
 * Compute the inner content box (in mm) for a resolved profile. This is
 * the area the paginator fills and the limit the diagnostics compare
 * against.
 */
export function contentBoxMm(profile: ResolvedPageProfile): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(
      1,
      profile.widthMm - profile.marginMm.left - profile.marginMm.right,
    ),
    height: Math.max(
      1,
      profile.heightMm - profile.marginMm.top - profile.marginMm.bottom,
    ),
  };
}
