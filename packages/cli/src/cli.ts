/**
 * Seevee CLI entry point.
 *
 * Spec: `.dev/specs/CLI_INSTALLER.md` (§9 commands, §10 exit codes).
 *
 * This module owns argv handling, help/version emission, subcommand dispatch,
 * and structured JSON output. Command implementations live in dedicated
 * modules under `packages/cli/src/commands/`.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runInit } from './commands/init.js';
import { runStart } from './commands/start.js';
import { runStop } from './commands/stop.js';
import { runRestart } from './commands/restart.js';
import { runStatus } from './commands/status.js';
import { runOpen } from './commands/open.js';
import { runValidate } from './commands/validate.js';
import { runDoctor } from './commands/doctor.js';
import { runExport } from './commands/export.js';
import { runComments } from './commands/comments.js';
import { runTemplate } from './commands/template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Stable exit codes per `.dev/specs/CLI_INSTALLER.md` §10. */
export const EXIT = {
  SUCCESS: 0,
  GENERAL: 1,
  USAGE: 2,
  NOT_INITIALIZED: 3,
  VALIDATION: 4,
  LIFECYCLE: 5,
  EXPORT: 6,
  MIGRATION: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const VERSION = process.env.SEEVEE_VERSION ?? '0.2.0';
export const SCHEMA_VERSION = '1.0.0';
export const RUNTIME_VERSION = VERSION;

/** Recognised subcommand names. */
export const COMMANDS = [
  'init',
  'start',
  'stop',
  'restart',
  'status',
  'open',
  'validate',
  'doctor',
  'export',
  'comments',
  'template',
] as const;
export type Command = (typeof COMMANDS)[number];

/** Flags accepted by the CLI. */
export interface GlobalFlags {
  json: boolean;
  help: boolean;
  version: boolean;
  port: number | null;
  host: string | null;
  noOpen: boolean;
  allowNetwork: boolean;
  template: string | null;
  output: string | null;
  draft: string | null;
  all: boolean;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

export interface ParsedArgs {
  command: Command | null;
  positional: string[];
  flags: GlobalFlags;
}

/** Optional per-command option bag. */
export interface CommandContext {
  rawArgs: readonly string[];
  positional: readonly string[];
  flags: GlobalFlags;
  cwd: string;
}

export interface CommandResult {
  ok: boolean;
  code: ExitCode;
  data?: unknown;
  message?: string;
}

const DEFAULT_FLAGS: GlobalFlags = {
  json: false,
  help: false,
  version: false,
  port: null,
  host: null,
  noOpen: false,
  allowNetwork: false,
  template: null,
  output: null,
  draft: null,
  all: false,
  logLevel: 'info',
};

type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

const COMMAND_HANDLERS: Readonly<Record<Command, CommandHandler>> = {
  init: runInit,
  start: runStart,
  stop: runStop,
  restart: runRestart,
  status: runStatus,
  open: runOpen,
  validate: runValidate,
  doctor: runDoctor,
  export: runExport,
  comments: runComments,
  template: runTemplate,
};

/**
 * Parse a raw argv list into structured command + flags.
 * Exported for testing; throws `CliUsageError` on bad input.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: GlobalFlags = { ...DEFAULT_FLAGS };
  const positional: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined || arg === '') {
      i += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      i += 1;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      flags.version = true;
      i += 1;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      i += 1;
      continue;
    }
    if (arg === '--all') {
      flags.all = true;
      i += 1;
      continue;
    }
    if (arg === '--no-open') {
      flags.noOpen = true;
      i += 1;
      continue;
    }
    if (arg === '--allow-network') {
      flags.allowNetwork = true;
      i += 1;
      continue;
    }
    if (arg === '--silent') {
      flags.logLevel = 'silent';
      i += 1;
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      flags.logLevel = 'error';
      i += 1;
      continue;
    }
    if (arg === '--verbose' || arg === '-v') {
      flags.logLevel = 'debug';
      i += 1;
      continue;
    }
    if (arg === '--port') {
      const next = argv[i + 1];
      if (next === undefined) throw new CliUsageError('--port requires a value');
      flags.port = parsePort(next);
      i += 2;
      continue;
    }
    if (arg.startsWith('--port=')) {
      flags.port = parsePort(arg.slice('--port='.length));
      i += 1;
      continue;
    }
    if (arg === '--host') {
      const next = argv[i + 1];
      if (next === undefined) throw new CliUsageError('--host requires a value');
      flags.host = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--host=')) {
      flags.host = arg.slice('--host='.length);
      i += 1;
      continue;
    }
    if (arg === '--template') {
      const next = argv[i + 1];
      if (next === undefined) throw new CliUsageError('--template requires a value');
      flags.template = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--template=')) {
      flags.template = arg.slice('--template='.length);
      i += 1;
      continue;
    }
    if (arg === '--draft') {
      const next = argv[i + 1];
      if (next === undefined) throw new CliUsageError('--draft requires a value');
      flags.draft = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--draft=')) {
      flags.draft = arg.slice('--draft='.length);
      i += 1;
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      const next = argv[i + 1];
      if (next === undefined) throw new CliUsageError('--output requires a value');
      flags.output = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--output=')) {
      flags.output = arg.slice('--output='.length);
      i += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new CliUsageError(`unknown flag: ${arg}`);
    }

    positional.push(arg);
    i += 1;
  }

  let command: Command | null = null;
  const head = positional.shift();
  if (head !== undefined) {
    if ((COMMANDS as readonly string[]).includes(head)) {
      command = head as Command;
    } else if (head === 'help') {
      flags.help = true;
    } else {
      throw new CliUsageError(`unknown command: ${head}`);
    }
  }

  return { command, positional, flags };
}

function parsePort(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliUsageError(`--port must be an integer in 1..65535 (got ${raw})`);
  }
  return parsed;
}

/** Thrown for invalid CLI usage. Maps to exit code 2. */
export class CliUsageError extends Error {
  public override readonly name = 'CliUsageError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when the workspace is missing or uninitialised. Maps to exit 3. */
export class WorkspaceNotInitializedError extends Error {
  public override readonly name = 'WorkspaceNotInitializedError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when validation fails. Maps to exit 4. */
export class ValidationError extends Error {
  public override readonly name = 'ValidationError';
  public readonly issues: readonly unknown[];
  constructor(message: string, issues: readonly unknown[] = []) {
    super(message);
    this.issues = issues;
  }
}

/** Thrown when server lifecycle (start/stop/restart) fails. Maps to exit 5. */
export class LifecycleError extends Error {
  public override readonly name = 'LifecycleError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when PDF export fails. Maps to exit 6. */
export class ExportError extends Error {
  public override readonly name = 'ExportError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when a schema migration is required. Maps to exit 7. */
export class MigrationRequiredError extends Error {
  public override readonly name = 'MigrationRequiredError';
  constructor(message: string) {
    super(message);
  }
}

const HELP_TEXT = `Seevee — local CV workspace CLI

Usage:
  seevee [command] [path] [flags]

Commands:
  init [path]          scaffold + validate + start + open + exit
  start [path]         start the background server + exit
  stop [path]          stop the workspace server
  restart [path]       restart the background server
  status [path]        print machine/human-readable runtime status
  open [path]          open the active dashboard in a browser
  validate [path]      run schema + semantic validation
  doctor [path]        diagnose runtime/browser/schema/template problems
  export [path]        report CLI PDF export availability and dashboard fallback
  comments list [path] list actionable comments for the active CV
  template <sub>       template lifecycle: list, draft, validate, compile, activate

Flags:
  --json               emit structured JSON for status/validate/doctor/export/comments/template
  --all                include resolved comments (comments list)
  --no-open            skip launching the browser (init, open)
  --port <number>      bind port (default: workspace runtime, else random loopback)
  --host <address>     bind host (default: 127.0.0.1; non-loopback requires --allow-network)
  --allow-network      permit non-loopback --host
  --template <id>      template id (export, template)
  --draft <version>    template draft version id (template)
  --output, -o <path>  output path (export)
  --silent             suppress non-error output
  --quiet, -q          suppress informational output
  --verbose, -v        enable debug output
  --version, -V        print CLI/runtime/schema versions and exit
  --help, -h           print this help and exit

Exit codes:
  0 success
  1 general failure
  2 invalid CLI usage
  3 workspace not initialized
  4 validation failure
  5 server startup/lifecycle failure
  6 export/render failure
  7 migration required/failed

See .dev/specs/CLI_INSTALLER.md for the full contract.
`;

/** Render the help block. Exposed for tests. */
export function renderHelp(): string {
  return HELP_TEXT;
}

/** Render the version block. Exposed for tests. */
export function renderVersion(): string {
  return JSON.stringify(
    {
      cli: VERSION,
      runtime: RUNTIME_VERSION,
      schema: SCHEMA_VERSION,
      node: process.version,
    },
    null,
    2,
  );
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** Top-level entry point. Parses argv, dispatches, returns an exit code. */
export async function run(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`seevee: ${message}\n\n${HELP_TEXT}`);
    return EXIT.USAGE;
  }

  if (parsed.flags.version) {
    process.stdout.write(`${renderVersion()}\n`);
    return EXIT.SUCCESS;
  }

  if (parsed.flags.help || parsed.command === null) {
    process.stdout.write(HELP_TEXT);
    return parsed.flags.help ? EXIT.SUCCESS : EXIT.USAGE;
  }

  if (
    parsed.flags.host !== null &&
    !isLoopbackHost(parsed.flags.host) &&
    !parsed.flags.allowNetwork
  ) {
    process.stderr.write(
      `seevee: refusing to bind to non-loopback host "${parsed.flags.host}". ` +
        `Pass --allow-network to override.\n`,
    );
    return EXIT.USAGE;
  }

  const ctx: CommandContext = {
    rawArgs: argv,
    positional: parsed.positional,
    flags: parsed.flags,
    cwd: process.cwd(),
  };

  const handler = COMMAND_HANDLERS[parsed.command];

  try {
    const result = await handler(ctx);
    return emitResult(result, parsed.flags);
  } catch (err) {
    const fallback: ExitCode =
      err instanceof CliUsageError
        ? EXIT.USAGE
        : err instanceof WorkspaceNotInitializedError
          ? EXIT.NOT_INITIALIZED
          : err instanceof ValidationError
            ? EXIT.VALIDATION
            : err instanceof LifecycleError
              ? EXIT.LIFECYCLE
              : err instanceof ExportError
                ? EXIT.EXPORT
                : err instanceof MigrationRequiredError
                  ? EXIT.MIGRATION
                  : EXIT.GENERAL;
    return reportError(err, parsed.flags, fallback);
  }
}

function reportError(err: unknown, flags: GlobalFlags, code: ExitCode): number {
  const message = err instanceof Error ? err.message : String(err);
  if (flags.json) {
    const payload = {
      ok: false,
      code,
      error: {
        name: err instanceof Error ? err.name : 'Error',
        message,
      },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`seevee: ${message}\n`);
  }
  return code;
}

function emitResult(result: CommandResult, flags: GlobalFlags): number {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.message !== undefined && result.message !== '') {
    process.stdout.write(`${result.message}\n`);
  }
  return result.code;
}

/**
 * Module entry. When invoked directly (i.e. `node dist/cli.js …` or via
 * the `seevee` bin), `run(process.argv.slice(2))` is the entry. Tests can
 * import `run` directly without invoking `process.exit`.
 */
const invokedDirectly = (() => {
  if (typeof process === 'undefined') return false;
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return path.resolve(argv1) === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const exitCode = await run(process.argv.slice(2));
  // `process.exit` is required because detached subcommands (init/start)
  // intentionally detach background processes from this event loop.
  process.exit(exitCode);
}
