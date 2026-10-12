import express from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';
import {
  TOPUP_COLUMNS,
  createTopup,
  cancelTopup,
  reconcileTopup,
  expirePending,
  limits,
} from '../lib/topups.js';
import { isConfigured, payhereMode } from '../lib/payhere.js';

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['pending', 'succeeded', 'failed', 'cancelled', 'expired', 'review'];

const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const requirePassenger = (req, res, next) => {
  if (req.user.role !== 'user') return res.status(403).json({ success: false, message: 'Not permitted' });
  if (req.body?.userId !== undefined && Number(req.body.userId) !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not permitted' });
  }
  next();
};

// Limits and availability for the top-up form.
router.get('/config', handle(async (req, res) => {
  res.json({ success: true, ...limits(), available: isConfigured(), mode: payhereMode() });
}));

router.post('/', requirePassenger, handle(async (req, res) => {
  const result = await createTopup(req.user, req.body.amount);
  res.json({ success: true, ...result });
}));

router.get('/mine', handle(async (req, res) => {
  await expirePending(req.user.id);
  const { rows } = await query(
    `SELECT ${TOPUP_COLUMNS} FROM topups WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({ success: true, topups: rows });
}));

router.get('/', requireRole('admin'), handle(async (req, res) => {
  const status = req.query.status;
  if (status !== undefined && status !== '' && !STATUSES.includes(status)) {
    throw new HttpError(400, 'Invalid status.');
  }
  const userId = req.query.userId ? toId(req.query.userId) : null;
  await expirePending();
  const { rows } = await query(
    `SELECT t.id, t.user_id AS "userId", u.username, t.amount, t.status,
            t.failure_reason AS "failureReason", t.payment_id AS "paymentId",
            t.created_at AS "createdAt"
     FROM topups t JOIN users u ON u.id = t.user_id
     WHERE ($1::text IS NULL OR t.status = $1) AND ($2::int IS NULL OR t.user_id = $2)
     ORDER BY t.id DESC LIMIT 100`,
    [status || null, userId]
  );
  res.json({ success: true, topups: rows });
}));

// Own attempt for a Passenger; any for an Admin. 404 hides other Passengers' attempts.
const loadTopup = async (req) => {
  const id = toId(req.params.id);
  if (id === null) throw new HttpError(404, 'Top-up not found');
  const { rows } = await query('SELECT * FROM topups WHERE id = $1', [id]);
  const topup = rows[0];
  if (!topup || (req.user.role !== 'admin' && topup.user_id !== req.user.id)) {
    throw new HttpError(404, 'Top-up not found');
  }
  return topup;
};

const publicTopup = (t) => ({
  id: t.id,
  amount: t.amount,
  status: t.status,
  failureReason: t.failure_reason,
  createdAt: t.created_at,
});

router.get('/:id', handle(async (req, res) => {
  let topup = await loadTopup(req);
  if (topup.status === 'pending' && topup.expires_at < new Date()) {
    await expirePending();
    topup = await loadTopup(req);
  }
  if (topup.status === 'pending' || topup.status === 'expired') {
    await reconcileTopup(topup);
    topup = await loadTopup(req);
  }
  const { rows } = await query('SELECT balance FROM users WHERE id = $1', [topup.user_id]);
  res.json({ success: true, topup: publicTopup(topup), balance: rows[0]?.balance ?? 0 });
}));

router.post('/:id/cancel', requirePassenger, handle(async (req, res) => {
  const topup = await loadTopup(req);
  await cancelTopup(topup);
  res.json({ success: true, topup: publicTopup(await loadTopup(req)) });
}));

export default router;
