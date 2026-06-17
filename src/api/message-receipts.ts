import { isJidGroup } from '@whiskeysockets/baileys';
import { receiptsRepo, computeReceiptStatus } from '../database/repositories/receipts.js';
import { groupsRepo } from '../database/repositories/groups.js';
import type { MessageRow } from '../database/repositories/messages.js';
import { toApiMessage } from '../types/mappers.js';
import type { ApiMessage } from '../types/api.js';

/**
 * Map message rows to API messages with an aggregate `receipt_status` attached
 * to outgoing ones (one batched receipts query; group participant counts cached
 * per call).
 */
export function toApiMessagesWithReceipts(rows: MessageRow[]): ApiMessage[] {
  const outgoingIds = rows.filter((r) => r.from_me === 1).map((r) => r.id);
  if (outgoingIds.length === 0) return rows.map((r) => toApiMessage(r));

  const aggregates = receiptsRepo.getAggregates(outgoingIds);
  const recipientCounts = new Map<string, number>();

  const recipientsFor = (jid: string): number => {
    let count = recipientCounts.get(jid);
    if (count === undefined) {
      // Participants include ourselves; everyone else must ack.
      count = Math.max(0, (groupsRepo.getByJid(jid)?.participant_count ?? 0) - 1);
      recipientCounts.set(jid, count);
    }
    return count;
  };

  return rows.map((row) => {
    if (row.from_me !== 1) return toApiMessage(row);
    const group = !!isJidGroup(row.remote_jid);
    const status = computeReceiptStatus(
      aggregates.get(row.id),
      group,
      group ? recipientsFor(row.remote_jid) : 0
    );
    return toApiMessage(row, { receipt_status: status });
  });
}
