// Typed errors for the template render pipeline.
//
// Every failure mode a template author can hit gets its own class so the
// dashboard can show an actionable message instead of a stack trace:
// a missing template directory, a manifest that doesn't parse, an entry file
// that isn't there, an Astro compile error (with file/line), and a runtime
// error thrown from inside the template's own frontmatter.

/** Base class for everything this package throws. */
export class TemplateRenderError extends Error {
  /** Machine-readable discriminator, stable across versions. */
  readonly code: TemplateRenderErrorCode;

  constructor(code: TemplateRenderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TemplateRenderError';
    this.code = code;
  }
}

export type TemplateRenderErrorCode =
  | 'TEMPLATE_ROOT_NOT_FOUND'
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_INVALID'
  | 'ENTRY_NOT_FOUND'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR';

/** The template root directory does not exist or is not a directory. */
export class TemplateRootNotFoundError extends TemplateRenderError {
  readonly templateRoot: string;

  constructor(templateRoot: string, options?: ErrorOptions) {
    super(
      'TEMPLATE_ROOT_NOT_FOUND',
      `Template root does not exist: ${templateRoot}`,
      options,
    );
    this.name = 'TemplateRootNotFoundError';
    this.templateRoot = templateRoot;
  }
}

/** `template.json` is absent from the template root. */
export class ManifestNotFoundError extends TemplateRenderError {
  readonly templateRoot: string;

  constructor(templateRoot: string, options?: ErrorOptions) {
    super(
      'MANIFEST_NOT_FOUND',
      `No template.json found in template root: ${templateRoot}`,
      options,
    );
    this.name = 'ManifestNotFoundError';
    this.templateRoot = templateRoot;
  }
}

/** `template.json` exists but does not satisfy the manifest schema. */
export class ManifestInvalidError extends TemplateRenderError {
  readonly templateRoot: string;

  constructor(templateRoot: string, detail: string, options?: ErrorOptions) {
    super('MANIFEST_INVALID', `Invalid template.json in ${templateRoot}: ${detail}`, options);
    this.name = 'ManifestInvalidError';
    this.templateRoot = templateRoot;
  }
}

/** The requested entry `.astro` file is not inside the template root. */
export class EntryNotFoundError extends TemplateRenderError {
  readonly entry: string;
  readonly resolvedPath: string;

  constructor(entry: string, resolvedPath: string, options?: ErrorOptions) {
    super(
      'ENTRY_NOT_FOUND',
      `Template entry not found: ${entry} (resolved to ${resolvedPath})`,
      options,
    );
    this.name = 'EntryNotFoundError';
    this.entry = entry;
    this.resolvedPath = resolvedPath;
  }
}

/**
 * The template failed to compile. `file`/`line`/`column` are pulled out of
 * the underlying Rollup/Astro error when Vite reports them so the dashboard
 * can point at the offending source line.
 */
export class TemplateCompileError extends TemplateRenderError {
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;

  constructor(
    message: string,
    location: { file: string | null; line: number | null; column: number | null },
    options?: ErrorOptions,
  ) {
    const { file, line, column } = location;
    // Point at the source line whenever Vite reported one — a bare compile
    // message is not actionable in a template editor.
    const located =
      file === null || line === null
        ? message
        : `${message} (${file}:${line}${column === null ? '' : `:${column}`})`;
    super('COMPILE_ERROR', located, options);
    this.name = 'TemplateCompileError';
    this.file = file;
    this.line = line;
    this.column = column;
  }
}

/** The template compiled but threw while rendering. */
export class TemplateRuntimeError extends TemplateRenderError {
  constructor(message: string, options?: ErrorOptions) {
    super('RUNTIME_ERROR', message, options);
    this.name = 'TemplateRuntimeError';
  }
}

/** Narrow an unknown throwable to `TemplateRenderError`. */
export function isTemplateRenderError(value: unknown): value is TemplateRenderError {
  return value instanceof TemplateRenderError;
}