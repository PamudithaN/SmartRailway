import express from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const UID_PATTERN = /^[0-9A-Fa-f]{4,32}$/;

const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

router.get('/', handle(async (req, res) => {
  const userId = req.query.userId ? toId(req.query.userId) : null;
  const { rows } = await query(
    `SELECT c.id, c.uid, c.user_id AS "userId", u.username, c.status, c.created_at AS "createdAt"
     FROM cards c JOIN users u ON u.id = c.user_id
     WHERE ($1::int IS NULL OR c.user_id = $1)
     ORDER BY c.id DESC LIMIT 200`,
    [userId]
  );
  res.json({ success: true, cards: rows });
}));

router.post('/', handle(async (req, res) => {
  const userId = toId(req.body.userId);
  const uid = String(req.body.uid ?? '').trim().toUpperCase();
  if (!UID_PATTERN.test(uid)) throw new HttpError(400, 'Card UID must be 4-32 hexadecimal characters.');
  if (userId === null) throw new HttpError(404, 'Passenger not found');

  const user = (await query('SELECT role, status FROM users WHERE id = $1', [userId])).rows[0];
  if (!user || user.status === 'deleted') throw new HttpError(404, 'Passenger not found');
  if (user.role !== 'user') throw new HttpError(400, 'Cards can only be registered to Passengers.');

  try {
    const { rows } = await query(
      'INSERT INTO cards (uid, user_id) VALUES ($1, $2) RETURNING id, uid, user_id AS "userId", status',
      [uid, userId]
    );
    res.json({ success: true, card: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Card already registered');
    throw err;
  }
}));

router.put('/:id/status', handle(async (req, res) => {
  const id = toId(req.params.id);
  const { status } = req.body;
  if (status !== 'active' && status !== 'blocked') throw new HttpError(400, 'Status must be active or blocked.');
  const { rows } = id === null ? { rows: [] } : await query(
    'UPDATE cards SET status = $2 WHERE id = $1 RETURNING id, uid, user_id AS "userId", status',
    [id, status]
  );
  if (rows.length === 0) throw new HttpError(404, 'Card not found');
  res.json({ success: true, card: rows[0] });
}));

export default router;
