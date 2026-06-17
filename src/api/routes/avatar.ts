import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { connectionManager } from '../../connection/manager.js';
import { config } from '../../config.js';
import { isValidJid } from '../../utils/security.js';
import { asyncHandler, BadRequestError, NotFoundError } from '../errors.js';
import { log } from '../../utils/logger.js';

const router = Router();

const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

/** Coalesce concurrent fetches for the same jid into one upstream request. */
const inflight = new Map<string, Promise<string | null>>();

function avatarDir(): string {
  const dir = path.join(config.mediaDir, 'avatars');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  }
  return dir;
}

function cachePaths(jid: string): { image: string; negative: string } {
  const hash = createHash('sha256').update(jid).digest('hex');
  const dir = avatarDir();
  return { image: path.join(dir, `${hash}.jpg`), negative: path.join(dir, `${hash}.none`) };
}

function isFresh(file: string, ttlMs: number): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

/** Fetch the current profile picture and cache it (or a negative marker). */
async function refreshAvatar(jid: string, paths: { image: string; negative: string }): Promise<string | null> {
  const existing = inflight.get(jid);
  if (existing) return existing;

  const task = (async () => {
    try {
      const url = await connectionManager.getProfilePicUrl(jid);
      if (!url) {
        fs.writeFileSync(paths.negative, '');
        return null;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`avatar fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(paths.image, buf, { mode: 0o640 });
      fs.rmSync(paths.negative, { force: true });
      return paths.image;
    } finally {
      inflight.delete(jid);
    }
  })();

  inflight.set(jid, task);
  return task;
}

// GET /api/avatar/:jid — profile picture bytes, disk-cached (7d TTL, 24h
// negative cache). Serves a stale copy when WhatsApp can't be reached.
router.get('/:jid', asyncHandler(async (req, res) => {
  const jid = req.params.jid as string;
  if (!isValidJid(jid)) {
    throw new BadRequestError('Invalid JID format');
  }
  const paths = cachePaths(jid);

  const send = (file: string): void => {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('jpg').sendFile(path.resolve(file));
  };

  if (isFresh(paths.image, AVATAR_TTL_MS)) {
    return send(paths.image);
  }
  if (isFresh(paths.negative, NEGATIVE_TTL_MS)) {
    throw new NotFoundError('No profile picture');
  }

  try {
    const file = await refreshAvatar(jid, paths);
    if (file) return send(file);
  } catch (err) {
    log.api.debug({ err, jid }, 'Avatar refresh failed');
    // Stale beats broken: fall back to any cached copy.
    if (fs.existsSync(paths.image)) return send(paths.image);
  }
  throw new NotFoundError('No profile picture');
}));

export default router;
