import { Router, Request, Response } from 'express';
import { groupsRepo } from '../../database/repositories/groups.js';
import { chatsRepo } from '../../database/repositories/chats.js';
import { connectionManager } from '../../connection/manager.js';

const router = Router();

// GET /api/groups — list all groups
router.get('/', (req: Request, res: Response) => {
  try {
    const groups = groupsRepo.getAll(req.query.search as string);
    res.json({ data: groups, total: groups.length });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/groups/:jid — single group with participants
router.get('/:jid', (req: Request, res: Response) => {
  try {
    const group = groupsRepo.getByJid(req.params.jid as string);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const participants = groupsRepo.getParticipants(req.params.jid as string);
    res.json({ ...group, participants });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/groups/:jid/metadata — fetch fresh metadata from WhatsApp
router.get('/:jid/metadata', async (req: Request, res: Response) => {
  try {
    const metadata = await connectionManager.getGroupMetadata(req.params.jid as string);
    res.json(metadata);
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/groups/:jid/invite-code
router.get('/:jid/invite-code', async (req: Request, res: Response) => {
  try {
    const code = await connectionManager.getGroupInviteCode(req.params.jid as string);
    res.json({ code });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/groups/:jid/subject
router.put('/:jid/subject', async (req: Request, res: Response) => {
  try {
    await connectionManager.groupUpdateSubject(req.params.jid as string, req.body.subject);
    res.json({ success: true });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/groups/:jid/description
router.put('/:jid/description', async (req: Request, res: Response) => {
  try {
    await connectionManager.groupUpdateDescription(req.params.jid as string, req.body.description);
    res.json({ success: true });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/groups/sync — sync all group chats from WhatsApp
router.post('/sync', async (_req: Request, res: Response) => {
  try {
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
              metadata.participants.map((p: any) => ({
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
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/groups/:jid/participants — add/remove/promote/demote
router.post('/:jid/participants', async (req: Request, res: Response) => {
  try {
    const { participants, action } = req.body;
    if (!participants || !action) {
      res.status(400).json({ error: 'Missing participants or action' });
      return;
    }
    const ALLOWED_ACTIONS = ['add', 'remove', 'promote', 'demote'];
    if (!ALLOWED_ACTIONS.includes(action)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${ALLOWED_ACTIONS.join(', ')}` });
      return;
    }
    const result = await connectionManager.groupParticipantsUpdate(
      req.params.jid as string,
      participants,
      action
    );
    res.json({ success: true, result });
  } catch (err) {
    console.error('[API]', err); res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
