import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { settingsUpdateSchema } from '../schemas.js';
import { getSettingsForApi, updateSettings } from '../../settings.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// GET /api/settings — list all settings with defaults and override status
router.get('/', asyncHandler(async (_req, res) => {
  res.json({ data: getSettingsForApi() });
}));

// PUT /api/settings — update one or more settings
router.put('/', validate(settingsUpdateSchema), asyncHandler(async (req, res) => {
  updateSettings(req.body);
  res.json({ data: getSettingsForApi() });
}));

export default router;
