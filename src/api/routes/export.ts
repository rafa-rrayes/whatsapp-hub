import { Router } from 'express';
import { exportRequestSchema } from '../schemas.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, BadRequestError } from '../errors.js';
import { runExport } from '../../export/runner.js';

const router = Router();

// POST /api/export — full-featured export
router.post('/', validate(exportRequestSchema), asyncHandler(async (req, res) => {
  await runExport(req.body, req, res);
}));

// GET /api/export — convenience for trivial exports (?days=N&format=md&preset=concise)
//
// Anything more complex (chat lists, multi-value filters, privacy flags) should use POST.
// The query-string types are coerced to the schema's expected types before parsing.
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query;
  const candidate: Record<string, unknown> = {};

  // Time
  if (q.days !== undefined) candidate.days = Number(q.days);
  if (q.from !== undefined) candidate.from = /^\d+$/.test(String(q.from)) ? Number(q.from) : String(q.from);
  if (q.to !== undefined) candidate.to = /^\d+$/.test(String(q.to)) ? Number(q.to) : String(q.to);

  // Rendering
  if (q.format !== undefined) candidate.format = String(q.format);
  if (q.preset !== undefined) candidate.preset = String(q.preset);
  if (q.timezone !== undefined) candidate.timezone = String(q.timezone);
  if (q.media !== undefined) candidate.media = String(q.media);
  if (q.reactions !== undefined) candidate.reactions = String(q.reactions);
  if (q.date_grouping !== undefined) candidate.date_grouping = String(q.date_grouping);
  if (q.sort_chats_by !== undefined) candidate.sort_chats_by = String(q.sort_chats_by);
  if (q.me_alias !== undefined) candidate.me_alias = String(q.me_alias);

  // Booleans
  for (const key of [
    'groups_only', 'dms_only', 'include_archived', 'include_muted', 'unread_only',
    'has_media', 'from_me', 'include_deleted', 'include_system',
    'redact_phone_numbers', 'anonymize_jids', 'strip_quoted_bodies',
    'prefer_saved_names', 'include_thumbnails',
  ] as const) {
    if (q[key] !== undefined) candidate[key] = q[key] === 'true' || q[key] === '1';
  }

  // Numbers
  for (const key of ['min_messages', 'min_body_length', 'max_messages', 'max_chats', 'max_media_size_mb'] as const) {
    if (q[key] !== undefined) candidate[key] = Number(q[key]);
  }

  if (q.search !== undefined) candidate.search = String(q.search);
  if (q.chat_search !== undefined) candidate.chat_search = String(q.chat_search);

  const parsed = exportRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0].message);
  }

  await runExport(parsed.data, req, res);
}));

export default router;
