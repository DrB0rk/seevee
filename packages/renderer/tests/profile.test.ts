// Profile-resolution tests. The renderer's page-profile contract is
// the boundary between the input data and the SDK's
// `evaluatePageLayout`. These tests pin every preset, every margin
// override, and the @page CSS produced for the three profiles the
// contract calls out (A4, Letter, Custom).

import { describe, it, expect } from 'vitest';

import {
  contentBoxMm,
  pageCss,
  resolveProfile,
  toSdkPageProfile,
} from '../src/profile.js';

describe('resolveProfile', () => {
  it('resolves A4 portrait to the documented mm dimensions', () => {
    const profile = resolveProfile({ preset: 'A4' });
    expect(profile.preset).toBe('A4');
    expect(profile.widthMm).toBe(210);
    expect(profile.heightMm).toBe(297);
    expect(profile.marginMm).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
  });

  it('resolves Letter portrait to US-letter dimensions', () => {
    const profile = resolveProfile({ preset: 'Letter' });
    expect(profile.preset).toBe('Letter');
    expect(profile.widthMm).toBe(215.9);
    expect(profile.heightMm).toBe(279.4);
  });

  it('honours landscape orientation by swapping width/height', () => {
    const profile = resolveProfile({ preset: 'A4', orientation: 'landscape' });
    expect(profile.widthMm).toBe(297);
    expect(profile.heightMm).toBe(210);
  });

  it('applies a custom margin override to every edge', () => {
    const profile = resolveProfile({ preset: 'A4', margins: 20 });
    expect(profile.marginMm).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
  });

  it('builds a Custom profile from explicit width and height', () => {
    const profile = resolveProfile({
      preset: 'Custom',
      width: 120,
      height: 240,
    });
    expect(profile.preset).toBe('Custom');
    expect(profile.widthMm).toBe(120);
    expect(profile.heightMm).toBe(240);
  });

  it('rejects Custom profiles missing dimensions', () => {
    expect(() => resolveProfile({ preset: 'Custom' })).toThrow(/width and height/);
  });

  it('rejects Custom profiles with non-positive dimensions', () => {
    expect(() =>
      resolveProfile({ preset: 'Custom', width: 5, height: 100 }),
    ).toThrow(/width/);
    expect(() =>
      resolveProfile({ preset: 'Custom', width: 100, height: 5 }),
    ).toThrow(/height/);
  });
});

describe('pageCss', () => {
  it('emits an @page rule with mm units for A4', () => {
    const profile = resolveProfile({ preset: 'A4' });
    const css = pageCss(profile);
    expect(css).toContain('@page');
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('margin: 12mm 12mm 12mm 12mm');
  });

  it('emits an @page rule with mm units for Letter', () => {
    const profile = resolveProfile({ preset: 'Letter' });
    const css = pageCss(profile);
    expect(css).toContain('size: 215.9mm 279.4mm');
  });

  it('emits an @page rule with mm units for Custom', () => {
    const profile = resolveProfile({
      preset: 'Custom',
      width: 120,
      height: 240,
      margins: 8,
    });
    const css = pageCss(profile);
    expect(css).toContain('size: 120mm 240mm');
    expect(css).toContain('margin: 8mm 8mm 8mm 8mm');
  });
});

describe('contentBoxMm', () => {
  it('subtracts the margins from the page dimensions', () => {
    const profile = resolveProfile({ preset: 'A4', margins: 12 });
    const box = contentBoxMm(profile);
    expect(box.width).toBe(210 - 24);
    expect(box.height).toBe(297 - 24);
  });
});

describe('toSdkPageProfile', () => {
  it('adapts the resolved profile into the SDK page-profile shape', () => {
    const profile = resolveProfile({ preset: 'A4', margins: 12 });
    const sdk = toSdkPageProfile(profile);
    expect(sdk.preset).toBe('A4');
    expect(sdk.edges).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(sdk.width).toBe(210);
    expect(sdk.height).toBe(297);
  });

  it('marks a Custom renderer profile as "custom" in the SDK shape', () => {
    const profile = resolveProfile({
      preset: 'Custom',
      width: 120,
      height: 240,
      margins: 8,
    });
    const sdk = toSdkPageProfile(profile);
    expect(sdk.preset).toBe('custom');
    expect(sdk.width).toBe(120);
    expect(sdk.height).toBe(240);
    expect(sdk.edges).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });
});
