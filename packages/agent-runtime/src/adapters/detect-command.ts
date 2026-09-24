import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';

const versionSchema = z.string().trim().min(1).max(512);

export interface CommandDetection {
  executablePath: string | null;
  version: string | null;
  error: string | null;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const extensions = process.platform === 'win32'
    ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of (env['PATH'] ?? '').split(path.delimiter)) {
    if (directory.length === 0) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // Continue through PATH.
      }
    }
  }
  return null;
}

export async function runCommand(
  executablePath: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; input?: string } = {},
): Promise<CommandOutput> {
  return new Promise<CommandOutput>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${path.basename(executablePath)} ${args[0] ?? ''} timed out during detection.`));
    }, options.timeoutMs ?? 8_000);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export async function detectCommand(command: string): Promise<CommandDetection> {
  const executablePath = await resolveExecutable(command);
  if (executablePath === null) return { executablePath: null, version: null, error: null };
  try {
    const result = await runCommand(executablePath, ['--version']);
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    const parsed = versionSchema.safeParse(combined.split(/\r?\n/u).at(-1) ?? combined);
    return {
      executablePath,
      version: parsed.success ? parsed.data : combined || null,
      error: result.exitCode === 0 ? null : combined || ` exited with code ${result.exitCode ?? 'unknown'}.`,
    };
  } catch (error) {
    return {
      executablePath,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
