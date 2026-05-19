import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { jsonResult, errorResult } from '../types.js';
import { resolveCandidates } from '../resolve.js';
import { messagesRepo } from '../../database/repositories/messages.js';
import { chatsRepo, type ChatRow } from '../../database/repositories/chats.js';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { groupsRepo } from '../../database/repositories/groups.js';

/** Message timestamps are stored as unix seconds (see schema usage of unixepoch). */
const SECONDS_PER_DAY = 86400;

function truncatePreview(body: string | undefined, max = 80): string {
  if (!body) return '';
  const trimmed = body.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + '…';
}

const overviewTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'whatsapp_overview',
      {
        title: 'WhatsApp overview',
        description:
          'High-level dashboard of the WhatsApp data: totals across chats, contacts, ' +
          'groups, and messages, plus recent activity within a configurable window and ' +
          'the most active chats. Call this first to orient yourself before drilling in.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(90)
            .default(7)
            .optional()
            .describe('Window size in days for "recent" stats. Default 7, max 90.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ days }) => {
        try {
          const windowDays = days ?? 7;
          const nowSec = Math.floor(Date.now() / 1000);
          const afterSec = nowSec - windowDays * SECONDS_PER_DAY;

          const stats = messagesRepo.getStats();
          const totalContacts = contactsRepo.getCount();
          const totalGroups = groupsRepo.getCount();

          // Pull a generous slice of recent chats — getAll sorts by last_message_ts DESC.
          const recentChats = chatsRepo.getAll({ limit: 200 });
          const totalChats = recentChats.length === 200
            ? // Total chat count isn't directly exposed; if we hit our cap, fall back to the
              // distinct remote_jid count from the stats byChat list — best-effort.
              Math.max(recentChats.length, stats.byChat.length)
            : recentChats.length;

          const unreadChatCount = recentChats.filter((c) => (c.unread_count ?? 0) > 0).length;

          // messages_in_window: a single aggregate query via repo.query with limit:1 so we
          // get the `total` without hauling rows around.
          const windowQuery = messagesRepo.query({ after: afterSec, limit: 1 });
          const messagesInWindow = windowQuery.total;

          // top_active_chats: walk the most recently active chats and count their messages
          // within the window. Cap the candidate pool so we don't fan out N+1 across every
          // chat in the DB.
          const candidateChats = recentChats.slice(0, 50);
          const scored: Array<{
            name: string;
            jid: string;
            is_group: boolean;
            message_count_in_window: number;
            last_message_ts: number | null;
          }> = [];
          for (const c of candidateChats) {
            const q = messagesRepo.query({
              remote_jid: c.jid,
              after: afterSec,
              limit: 1,
            });
            if (q.total === 0) continue;
            scored.push({
              name: c.name || c.jid,
              jid: c.jid,
              is_group: c.is_group === 1,
              message_count_in_window: q.total,
              last_message_ts: c.last_message_ts ?? null,
            });
          }
          scored.sort((a, b) => b.message_count_in_window - a.message_count_in_window);
          const topActiveChats = scored.slice(0, 5);

          const lastActivityTs = recentChats.length > 0
            ? (recentChats[0].last_message_ts ?? null)
            : null;

          return jsonResult({
            total_chats: totalChats,
            total_messages: stats.total,
            total_contacts: totalContacts,
            total_groups: totalGroups,
            messages_in_window: messagesInWindow,
            window_days: windowDays,
            unread_chat_count: unreadChatCount,
            top_active_chats: topActiveChats,
            last_activity_ts: lastActivityTs,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`whatsapp_overview failed: ${message}`);
        }
      },
    );
  },
};

const resolveContactTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'resolve_contact',
      {
        title: 'Resolve contact or chat',
        description:
          'Fuzzy lookup that maps a free-text query (name, partial name, phone number, ' +
          'or JID) to a ranked list of contacts, groups, and chats. Use this to translate ' +
          'a human-friendly reference like "Mom" or "dev group" into a JID before calling ' +
          'tools that require one.',
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe('Name, partial name, phone number, or JID to look up.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(30)
            .default(10)
            .optional()
            .describe('Maximum number of candidates to return. Default 10, max 30.'),
          groups_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only group chats are considered.'),
          dms_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only 1:1 (DM) chats are considered.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, limit, groups_only, dms_only }) => {
        if (groups_only && dms_only) {
          return errorResult('groups_only and dms_only are mutually exclusive');
        }
        try {
          const candidates = resolveCandidates(query, {
            groupsOnly: groups_only ?? false,
            dmsOnly: dms_only ?? false,
            limit: limit ?? 10,
          });
          return jsonResult({ query, candidates });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`resolve_contact failed: ${message}`);
        }
      },
    );
  },
};

const listChatsTool: McpTool = {
  register(server: McpServer) {
    server.registerTool(
      'list_chats',
      {
        title: 'List chats',
        description:
          'Browse chats with optional filters: unread-only, groups/DMs, name substring, ' +
          'active within N days. Results are sorted by most recent activity. Useful when ' +
          'you want to see which conversations exist without searching messages.',
        inputSchema: {
          unread_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return chats with unread_count > 0.'),
          groups_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return group chats.'),
          dms_only: z
            .boolean()
            .default(false)
            .optional()
            .describe('If true, only return 1:1 (DM) chats.'),
          name_contains: z
            .string()
            .min(1)
            .optional()
            .describe('Case-insensitive substring filter on the chat name or JID.'),
          active_since_days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Only return chats whose last message is within the last N days.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .default(30)
            .optional()
            .describe('Maximum number of chats to return. Default 30, max 200.'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({
        unread_only,
        groups_only,
        dms_only,
        name_contains,
        active_since_days,
        limit,
      }) => {
        if (groups_only && dms_only) {
          return errorResult('groups_only and dms_only are mutually exclusive');
        }
        try {
          const finalLimit = limit ?? 30;

          // Pull a larger pool than `limit` so in-memory filters still surface enough hits.
          // 5x is a reasonable balance; cap at 1000 to avoid pathological scans.
          const fetchLimit = Math.min(1000, Math.max(finalLimit * 5, 200));
          const rows: ChatRow[] = chatsRepo.getAll({
            search: name_contains,
            limit: fetchLimit,
          });

          const nowSec = Math.floor(Date.now() / 1000);
          const activeSinceSec = active_since_days
            ? nowSec - active_since_days * SECONDS_PER_DAY
            : null;

          const filtered = rows.filter((r) => {
            if (unread_only && (r.unread_count ?? 0) <= 0) return false;
            if (groups_only && r.is_group !== 1) return false;
            if (dms_only && r.is_group === 1) return false;
            if (activeSinceSec !== null && (r.last_message_ts ?? 0) < activeSinceSec) return false;
            return true;
          });

          filtered.sort((a, b) => (b.last_message_ts ?? 0) - (a.last_message_ts ?? 0));

          const chats = filtered.slice(0, finalLimit).map((r) => ({
            name: r.name || r.jid,
            jid: r.jid,
            is_group: r.is_group === 1,
            unread_count: r.unread_count ?? 0,
            last_message_ts: r.last_message_ts ?? null,
            last_message_preview: truncatePreview(r.last_message_body),
          }));

          return jsonResult({ total: filtered.length, chats });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`list_chats failed: ${message}`);
        }
      },
    );
  },
};

export const orientationTools: McpTool[] = [overviewTool, resolveContactTool, listChatsTool];
