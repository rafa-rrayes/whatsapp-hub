import type { Request, Response } from 'express';
import { sanitizeFilename } from '../utils/security.js';
import { resolveTimeWindow, selectChats, selectMessages } from './selector.js';
import { buildNameResolver } from './name-resolver.js';
import { renderMarkdown } from './render-md.js';
import { renderText } from './render-txt.js';
import { renderJson } from './render-json.js';
import { streamZip } from './zip-bundler.js';
import { PRESETS, type ExportContext, type ExportOptions, type MessageField, type SelectedChat, type SelectedMessage } from './types.js';

function pickFields(opts: ExportOptions): Set<MessageField> {
  if (opts.fields && opts.fields.length > 0) return new Set(opts.fields);
  return new Set(PRESETS[opts.preset]);
}

function makeFormatters(timezone: string) {
  // We intentionally use Intl with the user-specified timezone so output is local-correct.
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const dateGroup = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return {
    formatTime: (unix: number) => time.format(new Date(unix * 1000)),
    formatDate: (unix: number) => date.format(new Date(unix * 1000)),
    formatDateGroup: (unix: number) => dateGroup.format(new Date(unix * 1000)),
  };
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function timestampStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function extFor(format: ExportOptions['format']): string {
  return format === 'zip' ? 'zip' : format;
}

export async function runExport(opts: ExportOptions, req: Request, res: Response): Promise<void> {
  const window = resolveTimeWindow(opts);

  // Validate timezone — fall back to UTC if unrecognised
  const timezone = isValidTimezone(opts.timezone) ? opts.timezone : 'UTC';
  if (timezone !== opts.timezone) opts.timezone = timezone;

  // Determine base URL for media refs (req.protocol is honoured because of trust proxy)
  const proto = req.protocol;
  const host = req.get('host') || `localhost:${process.env.PORT || 3100}`;
  const baseUrl = `${proto}://${host}`;

  // Selection
  const selectedChats = selectChats(opts, window);
  const messagesByChat = new Map<string, SelectedMessage[]>();
  let budget = opts.max_messages;
  for (const sc of selectedChats) {
    const msgs = selectMessages(sc.chat.jid, window, opts, budget);
    messagesByChat.set(sc.chat.jid, msgs);
    // Budget consumes only "renderable" messages (excluding reactions if attached inline)
    const consumed = opts.reactions === 'inline'
      ? msgs.filter((m) => m.message_type !== 'reaction').length
      : msgs.length;
    budget -= consumed;
    if (budget <= 0) break;
  }

  // Filter to only chats that ended up with messages (or were explicitly requested)
  const allowlist = new Set(opts.chats || []);
  const finalChats: SelectedChat[] = selectedChats.filter((sc) => {
    if (allowlist.has(sc.chat.jid)) return true;
    return (messagesByChat.get(sc.chat.jid) || []).length > 0;
  });

  // Name resolver and context
  const resolver = buildNameResolver(opts);
  const fmt = makeFormatters(timezone);
  const ctx: ExportContext = {
    options: opts,
    window,
    baseUrl,
    generatedAt: new Date(),
    resolveName: (jid, fallbackPushName) => resolver.resolveName(jid, fallbackPushName),
    resolveChatLabel: (jid) => resolver.resolveChatLabel(jid),
    formatTime: fmt.formatTime,
    formatDate: fmt.formatDate,
    formatDateGroup: fmt.formatDateGroup,
    fields: pickFields(opts),
  };

  const filename = sanitizeFilename(`whatsapp-export-${timestampStamp(ctx.generatedAt)}.${extFor(opts.format)}`);

  if (opts.format === 'md') {
    const md = renderMarkdown(finalChats, messagesByChat, ctx);
    res.type('text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(md);
    return;
  }

  if (opts.format === 'txt') {
    const txt = renderText(finalChats, messagesByChat, ctx);
    res.type('text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(txt);
    return;
  }

  if (opts.format === 'json') {
    const obj = renderJson(finalChats, messagesByChat, ctx);
    res.type('application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(obj, null, 2));
    return;
  }

  if (opts.format === 'zip') {
    const md = renderMarkdown(finalChats, messagesByChat, ctx);
    res.type('application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await streamZip(md, finalChats, messagesByChat, ctx, res);
    return;
  }
}
