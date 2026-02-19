import { Router } from 'express';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { connectionManager } from '../../connection/manager.js';
import { isValidJid } from '../../utils/security.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';

const router = Router();

// GET /api/contacts — list all contacts
router.get('/', asyncHandler(async (req, res) => {
  const contacts = contactsRepo.getAll(req.query.search as string);
  res.json({ data: contacts, total: contacts.length });
}));

// GET /api/contacts/:jid — single contact
router.get('/:jid', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const contact = contactsRepo.getByJid(req.params.jid as string);
  if (!contact) {
    throw new NotFoundError('Contact not found');
  }
  res.json(contact);
}));

// GET /api/contacts/:jid/profile-pic — get profile picture URL
router.get('/:jid/profile-pic', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const url = await connectionManager.getProfilePicUrl(req.params.jid as string);
  res.json({ url: url || null });
}));

export default router;
