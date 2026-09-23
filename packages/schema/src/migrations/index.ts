/**
 * Migration framework for Seevee resources.
 *
 * Every schema family is independently versioned. Migrations are pure
 * functions from one canonical shape to the next, are deterministic, and
 * must never lose user data silently: any dropped field is surfaced in the
 * returned MigrationReport.
 */

export type SemVer = `${number}.${number}.${number}`;

export type MigrationContext = {
  /** File path relative to the workspace root, when known. */
  resourcePath?: string;
};

export type MigrationWarning = {
  code: string;
  message: string;
  path?: string;
};

export type MigrationReport = {
  from: SemVer;
  to: SemVer;
  warnings: MigrationWarning[];
};

export type Migration<TIn = unknown, TOut = TIn> = {
  /** Source schemaVersion this migration accepts. */
  from: SemVer;
  /** Target schemaVersion this migration produces. */
  to: SemVer;
  /** Human-readable summary of what the migration changes. */
  summary: string;
  /**
   * Pure deterministic transform. Must not perform I/O; must not mutate
   * the input document.
   */
  migrate: (doc: TIn, ctx: MigrationContext) => { doc: TOut; warnings: MigrationWarning[] };
};

/**
 * Compare two semver strings. Returns negative when a < b, 0 when equal,
 * positive when a > b. Pre-release handling is not needed for schema
 * versions, which are always stable triples.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * A migration chain for one schema family (e.g. seevee.cv). Each entry
 * migrates exactly one version step. Steps must be contiguous.
 */
export type MigrationChain = {
  /** Resource kind this chain applies to, e.g. `seevee.cv`. */
  kind: string;
  steps: Migration[];
};

export type MigrationResult<T = unknown> =
  | { ok: true; doc: T; report: MigrationReport[]; applied: number }
  | {
      ok: false;
      reason:
        | 'unknown-version'
        | 'no-path'
        | 'broken-chain'
        | 'invalid-input';
      message: string;
    };

/**
 * Plan the migration path from `from` to the latest version in the chain.
 * Returns the ordered list of steps to apply. Pure.
 */
export function planMigration(chain: MigrationChain, from: SemVer): Migration[] {
  // Steps must be sorted ascending by `from`.
  const sorted = [...chain.steps].sort((a, b) => compareSemVer(a.from, b.from));
  const path: Migration[] = [];
  let cursor = from;

  for (;;) {
    const next = sorted.find((step) => step.from === cursor);
    if (!next) break;
    path.push(next);
    cursor = next.to;
  }

  return path;
}

/**
 * Latest schema version reachable via this chain.
 */
export function latestVersion(chain: MigrationChain): SemVer {
  return chain.steps.reduce<SemVer>(
    (latest, step) => (compareSemVer(step.to, latest) > 0 ? step.to : latest),
    '0.0.0',
  );
}

/**
 * Apply migrations to bring `doc` from its current schemaVersion up to the
 * chain's latest version. The document must already be structurally valid
 * for its declared schemaVersion (structural validation is the caller's
 * responsibility — this module deals only with shape transforms).
 */
export function migrateDocument(
  chain: MigrationChain,
  doc: { schemaVersion: SemVer; [key: string]: unknown },
  ctx: MigrationContext = {},
): MigrationResult {
  const fromVersion = doc.schemaVersion;
  if (typeof fromVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(fromVersion)) {
    return {
      ok: false,
      reason: 'invalid-input',
      message: 'document has missing or malformed schemaVersion',
    };
  }

  const path = planMigration(chain, fromVersion);
  if (path.length === 0) {
    if (compareSemVer(fromVersion, latestVersion(chain)) === 0) {
      return { ok: true, doc, report: [], applied: 0 };
    }
    return {
      ok: false,
      reason: 'unknown-version',
      message:
        'no migration path from schemaVersion `' +
        fromVersion +
        '` to latest `' +
        latestVersion(chain) +
        '` for ' +
        chain.kind,
    };
  }

  let current: { schemaVersion: SemVer; [key: string]: unknown } = doc;
  const reports: MigrationReport[] = [];
  let warnings: MigrationWarning[] = [];

  for (const step of path) {
    if (current.schemaVersion !== step.from) {
      return {
        ok: false,
        reason: 'broken-chain',
        message:
          'chain expects schemaVersion `' +
          step.from +
          '` but document is at `' +
          current.schemaVersion +
          '`',
      };
    }
    const result = step.migrate(current, ctx);
    // Copy to guarantee the input is never mutated.
    current = { ...(result.doc as { schemaVersion: SemVer; [key: string]: unknown }) };
    current.schemaVersion = step.to;
    warnings = warnings.concat(result.warnings);
    reports.push({ from: step.from, to: step.to, warnings: result.warnings });
  }

  return { ok: true, doc: current, report: reports, applied: path.length };
}
