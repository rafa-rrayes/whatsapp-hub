import { Router, Request, Response } from 'express';
import { validate } from '../middleware/validate.js';
import { settingsUpdateSchema } from '../schemas.js';
import { getSettingsForApi, updateSettings } from '../../settings.js';
import { log } from '../../utils/logger.js';

const router = Router();

// GET /api/settings — list all settings with defaults and override status
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ data: getSettingsForApi() });
  } catch (err) {
    log.api.error({ err }, 'settings list failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings — update one or more settings
router.put('/', validate(settingsUpdateSchema), (req: Request, res: Response) => {
  try {
    updateSettings(req.body);
    res.json({ data: getSettingsForApi() });
  } catch (err) {
    log.api.error({ err }, 'settings update failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
