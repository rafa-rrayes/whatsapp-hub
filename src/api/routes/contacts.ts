import { Router, Request, Response } from 'express';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { connectionManager } from '../../connection/manager.js';
import { isValidJid } from '../../utils/security.js';
import { log } from '../../utils/logger.js';

const router = Router();

// GET /api/contacts — list all contacts
router.get('/', (req: Request, res: Response) => {
  try {
    const contacts = contactsRepo.getAll(req.query.search as string);
    res.json({ data: contacts, total: contacts.length });
  } catch (err) {
    log.api.error({ err }, 'contacts list failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/:jid — single contact
router.get('/:jid', (req: Request, res: Response) => {
  try {
    if (!isValidJid(req.params.jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const contact = contactsRepo.getByJid(req.params.jid as string);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json(contact);
  } catch (err) {
    log.api.error({ err }, 'contact detail failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/:jid/profile-pic — get profile picture URL
router.get('/:jid/profile-pic', async (req: Request, res: Response) => {
  try {
    if (!isValidJid(req.params.jid)) {
      res.status(400).json({ error: 'Invalid JID format' });
      return;
    }
    const url = await connectionManager.getProfilePicUrl(req.params.jid as string);
    res.json({ url: url || null });
  } catch (err) {
    log.api.error({ err }, 'profile-pic failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
