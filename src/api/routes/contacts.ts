import { Router } from 'express';
import { contactsRepo } from '../../database/repositories/contacts.js';
import { labelsRepo } from '../../database/repositories/labels.js';
import { connectionManager } from '../../connection/manager.js';
import { isValidJid } from '../../utils/security.js';
import { registerJidAlias, resolveToPhoneJid, resolveToLid } from '../../utils/jid.js';
import { asyncHandler, NotFoundError, BadRequestError } from '../errors.js';
import { toApiContact, toApiLabel } from '../../types/mappers.js';

/**
 * Collect every JID form (phone + LID) that may key this contact's label
 * associations. WhatsApp keys label associations by LID, but contacts are
 * stored under their phone JID — so we resolve across both, using the cached
 * alias map first and the live signal store (USync) as a fallback.
 */
async function resolveJidForms(jid: string): Promise<string[]> {
  const forms = new Set<string>([jid]);
  if (jid.endsWith('@s.whatsapp.net')) {
    const cached = resolveToLid(jid);
    if (cached) forms.add(cached);
    const lid = await connectionManager.resolveLidForPn(jid);
    if (lid) {
      forms.add(lid);
      registerJidAlias(lid, jid);
    }
  } else if (jid.endsWith('@lid')) {
    forms.add(resolveToPhoneJid(jid));
    const pn = await connectionManager.resolvePnForLid(jid);
    if (pn) {
      forms.add(pn);
      registerJidAlias(jid, pn);
    }
  }
  return [...forms];
}

const router = Router();

// GET /api/contacts — list all contacts
router.get('/', asyncHandler(async (req, res) => {
  const contacts = contactsRepo.getAll(req.query.search as string);
  res.json({ data: contacts.map(toApiContact), total: contacts.length });
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
  res.json(toApiContact(contact));
}));

// GET /api/contacts/:jid/profile-pic — get profile picture URL
router.get('/:jid/profile-pic', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const url = await connectionManager.getProfilePicUrl(req.params.jid as string);
  res.json({ url: url || null });
}));

// GET /api/contacts/:jid/labels — labels (tags) attached to this contact
router.get('/:jid/labels', asyncHandler(async (req, res) => {
  if (!isValidJid(req.params.jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const forms = await resolveJidForms(req.params.jid as string);
  const labels = labelsRepo.getLabelsForChats(forms);
  res.json({ data: labels.map(toApiLabel), total: labels.length });
}));

export default router;
