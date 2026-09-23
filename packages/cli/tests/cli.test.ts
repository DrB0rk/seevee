import { describe, it, expect } from 'vitest';
import { parseArgs, renderHelp, renderVersion, EXIT } from '../src/cli.js';

describe('parseArgs', () => {
  it('returns null command and default flags for empty argv', () => {
    const result = parseArgs([]);
    expect(result.command).toBeNull();
    expect(result.flags.json).toBe(false);
    expect(result.flags.help).toBe(false);
    expect(result.flags.version).toBe(false);
    expect(result.flags.port).toBeNull();
    expect(result.flags.host).toBeNull();
  });

  it('parses a known command', () => {
    const result = parseArgs(['start']);
    expect(result.command).toBe('start');
  });

  it('parses --json flag', () => {
    const result = parseArgs(['--json']);
    expect(result.flags.json).toBe(true);
  });

  it('parses --no-open flag', () => {
    const result = parseArgs(['--no-open']);
    expect(result.flags.noOpen).toBe(true);
  });

  it('parses --allow-network flag', () => {
    const result = parseArgs(['--allow-network']);
    expect(result.flags.allowNetwork).toBe(true);
  });

  it('parses --port flag', () => {
    const result = parseArgs(['--port', '43200']);
    expect(result.flags.port).toBe(43200);
  });

  it('parses --host flag', () => {
    const result = parseArgs(['--host', '0.0.0.0']);
    expect(result.flags.host).toBe('0.0.0.0');
  });

  it('collects positional arguments', () => {
    const result = parseArgs(['init', '/path/to/workspace']);
    expect(result.command).toBe('init');
    expect(result.positional).toEqual(['/path/to/workspace']);
  });

  it('parses --help before command', () => {
    const result = parseArgs(['--help', 'start']);
    expect(result.command).toBe('start');
    expect(result.flags.help).toBe(true);
  });

  it('rejects --port with non-numeric value', () => {
    expect(() => parseArgs(['--port', 'not-a-number'])).toThrow();
  });

  it('rejects --port out of range', () => {
    expect(() => parseArgs(['--port', '0'])).toThrow();
    expect(() => parseArgs(['--port', '65536'])).toThrow();
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--unknown-flag'])).toThrow();
  });

  it('rejects unknown commands', () => {
    expect(() => parseArgs(['notacommand'])).toThrow();
  });

  it('parses --silent flag', () => {
    expect(parseArgs(['--silent']).flags.logLevel).toBe('silent');
  });
});

describe('renderHelp', () => {
  it('contains the command list', () => {
    const text = renderHelp();
    expect(text).toContain('seevee');
    expect(text).toContain('init');
    expect(text).toContain('start');
    expect(text).toContain('stop');
    expect(text).toContain('status');
    expect(text).toContain('open');
    expect(text).toContain('validate');
    expect(text).toContain('doctor');
    expect(text).toContain('export');
  });

  it('contains the flag descriptions', () => {
    const text = renderHelp();
    expect(text).toContain('--json');
    expect(text).toContain('--no-open');
    expect(text).toContain('--port');
    expect(text).toContain('--host');
    expect(text).toContain('--allow-network');
  });
});

describe('renderVersion', () => {
  it('contains cli version', () => {
    const text = renderVersion();
    expect(text).toContain('"cli"');
    expect(text).toContain('"runtime"');
    expect(text).toContain('"schema"');
  });
});

describe('EXIT codes', () => {
  it('exports all required exit codes', () => {
    expect(EXIT.SUCCESS).toBe(0);
    expect(EXIT.GENERAL).toBe(1);
    expect(EXIT.USAGE).toBe(2);
    expect(EXIT.NOT_INITIALIZED).toBe(3);
    expect(EXIT.VALIDATION).toBe(4);
    expect(EXIT.LIFECYCLE).toBe(5);
    expect(EXIT.EXPORT).toBe(6);
    expect(EXIT.MIGRATION).toBe(7);
  });
});
