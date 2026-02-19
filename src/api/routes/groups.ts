import { Router } from 'express';
import { groupsRepo } from '../../database/repositories/groups.js';
import { chatsRepo } from '../../database/repositories/chats.js';
import { connectionManager } from '../../connection/manager.js';
import { isValidJid } from '../../utils/security.js';
import { validate } from '../middleware/validate.js';
import { groupSubjectSchema, groupDescriptionSchema, groupParticipantsSchema } from '../schemas.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';

const router = Router();

// GET /api/groups — list all groups
router.get('/', asyncHandler(async (req, res) => {
  const groups = groupsRepo.getAll(req.query.search as string);
  res.json({ data: groups, total: groups.length });
}));

// GET /api/groups/:jid — single group with participants
router.get('/:jid', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const group = groupsRepo.getByJid(req.params.jid as string);
  if (!group) {
    throw new NotFoundError('Group not found');
  }
  const participants = groupsRepo.getParticipants(req.params.jid as string);
  res.json({ ...group, participants });
}));

// GET /api/groups/:jid/metadata — fetch fresh metadata from WhatsApp
router.get('/:jid/metadata', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const metadata = await connectionManager.getGroupMetadata(req.params.jid as string);
  res.json(metadata);
}));

// GET /api/groups/:jid/invite-code
router.get('/:jid/invite-code', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const code = await connectionManager.getGroupInviteCode(req.params.jid as string);
  res.json({ code });
}));

// PUT /api/groups/:jid/subject
router.put('/:jid/subject', validate(groupSubjectSchema), asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  await connectionManager.groupUpdateSubject(req.params.jid as string, req.body.subject);
  res.json({ success: true });
}));

// PUT /api/groups/:jid/description
router.put('/:jid/description', validate(groupDescriptionSchema), asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  await connectionManager.groupUpdateDescription(req.params.jid as string, req.body.description);
  res.json({ success: true });
}));

// POST /api/groups/sync — sync all group chats from WhatsApp
router.post('/sync', asyncHandler(async (_req, res) => {
  const allChats = chatsRepo.getAll({ limit: 10000 });
  const groupChats = allChats.filter((c) => c.is_group === 1);

  let synced = 0;
  let failed = 0;

  for (const chat of groupChats) {
    try {
      const metadata = await connectionManager.getGroupMetadata(chat.jid);
      if (metadata) {
        groupsRepo.upsert({
          jid: metadata.id,
          name: metadata.subject,
          description: metadata.desc || undefined,
          owner_jid: metadata.owner || undefined,
          creation_time: metadata.creation,
          participant_count: metadata.participants?.length || 0,
          is_announce: metadata.announce ? 1 : 0,
          is_restrict: metadata.restrict ? 1 : 0,
        });
        if (metadata.participants) {
          groupsRepo.setParticipants(
            metadata.id,
            metadata.participants.map((p) => ({
              jid: p.id,
              role: p.admin || 'member',
            }))
          );
        }
        synced++;
      }
    } catch {
      failed++;
    }
  }

  res.json({ success: true, synced, failed, total: groupChats.length });
}));

// POST /api/groups/:jid/participants — add/remove/promote/demote
router.post('/:jid/participants', validate(groupParticipantsSchema), asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const { participants, action } = req.body;
  const result = await connectionManager.groupParticipantsUpdate(
    req.params.jid as string,
    participants,
    action
  );
  res.json({ success: true, result });
}));

export default router;
