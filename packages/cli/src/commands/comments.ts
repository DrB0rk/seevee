/** Read the actionable dashboard comments for the active CV. */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommandContext, CommandResult } from '../cli.js';
import { CliUsageError, WorkspaceNotInitializedError } from '../cli.js';
import { commentsDocumentSchema, workspaceDocumentSchema } from '@seevee/schema';
import { discoverWorkspace, WorkspaceNotFoundError } from '../runtime/workspace-discovery.js';

function latestMessage(thread: { messageOrder: string[]; messages: Record<string, { body: string; author: unknown; createdAt: string }> }) {
  const id = thread.messageOrder.at(-1);
  return id ? thread.messages[id] ?? null : null;
}

export async function runComments(ctx: CommandContext): Promise<CommandResult> {
  if (ctx.positional[0] !== 'list') {
    throw new CliUsageError('usage: seevee comments list [workspace-path] [--all] [--json]');
  }
  const target = ctx.positional[1];
  if (ctx.positional.length > 2) throw new CliUsageError('comments list accepts one optional workspace path');

  let ws;
  try {
    ws = await discoverWorkspace(target, ctx.cwd);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) throw new WorkspaceNotInitializedError(`no workspace at ${target ?? ctx.cwd}`);
    throw err;
  }

  let workspaceRaw: unknown;
  try {
    workspaceRaw = JSON.parse(await fs.readFile(ws.workspaceFile, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read workspace file ${ws.workspaceFile}: ${(err as Error).message}`);
  }
  const workspace = workspaceDocumentSchema.safeParse(workspaceRaw);
  if (!workspace.success) throw new Error(`invalid workspace file: ${ws.workspaceFile}`);

  const { cvId } = workspace.data.data.active;
  const registered = Object.values(workspace.data.data.resources.comments).find((resource) => resource.cvId === cvId);
  const threads: Array<Record<string, unknown>> = [];
  if (registered) {
    const commentPath = path.resolve(ws.root, registered.relativePath);
    const relative = path.relative(ws.root, commentPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('comments resource path escapes the workspace');
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(commentPath, 'utf8'));
    } catch (err) {
      throw new Error(`cannot read comments resource ${registered.relativePath}: ${(err as Error).message}`);
    }
    const comments = commentsDocumentSchema.safeParse(raw);
    if (!comments.success) throw new Error(`invalid comments resource: ${registered.relativePath}`);
    const includeAll = ctx.flags.all;
    for (const id of comments.data.data.threadOrder) {
      const thread = comments.data.data.threads[id];
      if (!thread || (!includeAll && !['open', 'in_progress'].includes(thread.status))) continue;
      const message = latestMessage(thread);
      const placement = thread.target.extensions?.['seevee.placement'] ?? null;
      threads.push({
        id: thread.id,
        status: thread.status,
        priority: thread.priority,
        category: thread.category,
        message: message?.body ?? null,
        author: message?.author ?? null,
        updatedAt: thread.updatedAt,
        target: thread.target,
        placement,
        agentWork: thread.agentWork,
      });
    }
  }

  const data = { workspace: ws.root, cvId, commentsResource: registered?.relativePath ?? null, count: threads.length, threads };
  const message = threads.length
    ? threads.map((thread) => {
      const selectors = thread.target as { selectors: Array<Record<string, unknown>> };
      const selector = selectors.selectors.find((item) => item.type !== 'PageRegionSelector') ?? selectors.selectors[0];
      const where = thread.placement && typeof thread.placement === 'object'
        ? (() => {
          const pin = thread.placement as Record<string, unknown>;
          const context = typeof pin.contextText === 'string' && pin.contextText ? ` (“${pin.contextText}”)` : '';
          const location = typeof pin.page === 'number'
            ? `, page ${pin.page} at ${Math.round(Number(pin.x) * 100)}% across / ${Math.round(Number(pin.y) * 100)}% down`
            : '';
          return ` — ${String(pin.element ?? 'page comment')}${context}${location}`;
        })()
        : selector?.type === 'PageRegionSelector'
          ? ` — page ${selector.page}, ${Math.round(Number(selector.x) * 100)}% across, ${Math.round(Number(selector.y) * 100)}% down`
          : '';
      const anchor = selector ? `\n  Anchor: ${JSON.stringify(selector)}` : '';
      return `[${thread.priority}] ${String(thread.status)} ${String(thread.id)}${where}${anchor}\n  ${String(thread.message ?? '(no message)')}`;
    }).join('\n')
    : `No open comments for active CV ${cvId}.`;

  return { ok: true, code: 0, data, message: ctx.flags.json ? undefined : message };
}
