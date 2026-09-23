import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PolicyError,
} from '../src/errors.js';
import {
  runPolicyScan,
  _forbiddenBuiltins,
  _forbiddenGlobals,
  _allowedSpecifiers,
} from '../src/policy-scan.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'seevee-policy-scan-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function write(rel: string, body: string): string {
  const abs = join(tempDir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  return abs;
}

describe('policy scan: documented reject lists', () => {
  it('forbids the required node builtins', () => {
    const list = _forbiddenBuiltins();
    expect(list).toContain('node:fs');
    expect(list).toContain('node:fs/promises');
    expect(list).toContain('node:child_process');
    expect(list).toContain('node:net');
    expect(list).toContain('node:http');
    expect(list).toContain('node:https');
    expect(list).toContain('node:tls');
    expect(list).toContain('node:dns');
    expect(list).toContain('node:os');
    expect(list).toContain('node:cluster');
    expect(list).toContain('node:worker_threads');
    expect(list).toContain('node:vm');
  });

  it('forbids the required globals', () => {
    const list = _forbiddenGlobals();
    expect(list).toContain('process');
    expect(list).toContain('Buffer');
    expect(list).toContain('eval');
    expect(list).toContain('Function');
  });

  it('allowlist contains the SDK and Astro entry points', () => {
    const allow = _allowedSpecifiers();
    expect(allow.has('@seevee/template-sdk')).toBe(true);
    expect(allow.has('@seevee/schema')).toBe(true);
    expect(allow.has('astro')).toBe(true);
    expect(allow.has('astro/components')).toBe(true);
    expect(allow.has('astro/jsx-runtime')).toBe(true);
    expect(allow.has('zod')).toBe(true);
  });
});

describe('policy scan: source-tree rejection', () => {
  it('rejects a template that imports node:fs', () => {
    write('src/Resume.astro', `---
import { readFileSync } from 'node:fs';
---
<div />`);
    expect(() => runPolicyScan(tempDir)).toThrow(PolicyError);
    expect(() => runPolicyScan(tempDir)).toThrow(/node:fs/);
  });

  it('rejects a template that uses dynamic import()', () => {
    write('src/lazy.ts', `export async function load() {
  const x = await import('node:fs');
  return x;
}`);
    expect(() => runPolicyScan(tempDir)).toThrow(PolicyError);
    expect(() => runPolicyScan(tempDir)).toThrow(/dynamic import/);
  });

  it('rejects a template that calls eval(', () => {
    write('src/evil.ts', `export const r = eval('1+1');`);
    expect(() => runPolicyScan(tempDir)).toThrow(/eval/);
  });

  it('rejects a template that constructs a Function', () => {
    write('src/evil.ts', `export const f = new Function('a', 'return a');`);
    expect(() => runPolicyScan(tempDir)).toThrow(/Function/);
  });

  it('rejects a template that references process.', () => {
    write('src/evil.ts', `export const env = process.env.NODE_ENV;`);
    expect(() => runPolicyScan(tempDir)).toThrow(/process/);
  });

  it('rejects a template that imports a package not on the allowlist', () => {
    write('src/evil.ts', `import x from 'lodash';`);
    expect(() => runPolicyScan(tempDir)).toThrow(/allowlist/);
  });

  it('rejects a template that uses import="*" — wildcards not in allowlist', () => {
    write('src/evil.ts', `import x from '*';`);
    expect(() => runPolicyScan(tempDir)).toThrow(/allowlist/);
  });
});

describe('policy scan: source-tree acceptance', () => {
  it('accepts a template that imports only @seevee/template-sdk', () => {
    write('src/Resume.astro', `---
import { Page, Section } from '@seevee/template-sdk';
---
<Page />`);
    write('src/Helpers.ts', `import { z } from 'zod';`);
    const result = runPolicyScan(tempDir);
    expect(result.imports).toBeGreaterThanOrEqual(2);
  });

  it('accepts a template that imports @seevee/schema and astro/components', () => {
    write('src/Resume.astro', `---
import type { CvDocument } from '@seevee/schema';
import { Page } from 'astro/components';
import { z } from 'zod';
---
<Page />`);
    expect(() => runPolicyScan(tempDir)).not.toThrow();
  });

  it('accepts a template that uses relative imports only', () => {
    write('src/Resume.astro', `---
import { helper } from './helper.js';
---
<div />`);
    write('src/helper.ts', `export function helper() { return 1; }`);
    expect(() => runPolicyScan(tempDir)).not.toThrow();
  });

  it('ignores node_modules and .git directories entirely', () => {
    write('src/Resume.astro', `---
import { Page } from '@seevee/template-sdk';
---
<Page />`);
    write('node_modules/evil/index.js', `import fs from 'node:fs';`);
    write('.git/hooks/post-commit', `#!/bin/sh\neval $@`);
    expect(() => runPolicyScan(tempDir)).not.toThrow();
  });
});

describe('policy scan: edge cases', () => {
  it('throws when the source root does not exist', () => {
    expect(() => runPolicyScan(join(tempDir, 'nope'))).toThrow(PolicyError);
  });

  it('returns zero counts for an empty source root', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    const result = runPolicyScan(tempDir);
    expect(result.files).toBe(0);
    expect(result.imports).toBe(0);
  });
});