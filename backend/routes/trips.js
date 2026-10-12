import express from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';
import { applyTap } from '../lib/tap.js';

const router = express.Router();
router.use(requireAuth);

const TRIP_SELECT = `
  SELECT t.id, t.user_id AS "userId", u.username, t.route_id AS "routeId", r.name AS "routeName",
         ss.name AS "startStation", es.name AS "endStation", t.fare, t.status,
         t.started_at AS "startedAt", t.ended_at AS "endedAt", t.cancel_reason AS "cancelReason",
         t.start_source AS "startSource", t.end_source AS "endSource"
  FROM trips t
  JOIN users u ON u.id = t.user_id
  JOIN routes r ON r.id = t.route_id
  JOIN stations ss ON ss.id = t.start_station_id
  LEFT JOIN stations es ON es.id = t.end_station_id`;

const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Reader bridge: Admin-authenticated until device authentication is designed.
router.post('/rfid/tap', requireRole('admin'), handle(async (req, res) => {
  const { action } = req.body;
  const userId = toId(req.body.userId);
  const routeId = toId(req.body.routeId);
  const stationId = toId(req.body.stationId);

  if (action !== 'start' && action !== 'end') throw new HttpError(400, 'Tap action must be start or end.');
  if (userId === null) throw new HttpError(404, 'RFID unregistered');
  if (routeId === null || stationId === null) throw new HttpError(400, 'Route and Station are required.');

  const { code, ...result } = await withTransaction((client) =>
    applyTap(client, { userId, routeId, stationId, action, source: 'admin' })
  );

  res.json({ success: true, ...result });
}));

router.get('/trips/mine', handle(async (req, res) => {
  const { rows } = await query(`${TRIP_SELECT} WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT 20`, [req.user.id]);
  res.json({ success: true, trips: rows });
}));

router.get('/trips', requireRole('admin'), handle(async (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !['open', 'completed', 'cancelled'].includes(status)) {
    throw new HttpError(400, 'Invalid status.');
  }
  const userId = req.query.userId === undefined ? null : toId(req.query.userId);
  const { rows } = await query(
    `${TRIP_SELECT}
     WHERE ($1::text IS NULL OR t.status = $1) AND ($2::int IS NULL OR t.user_id = $2)
     ORDER BY t.id DESC LIMIT 100`,
    [status ?? null, userId]
  );
  res.json({ success: true, trips: rows });
}));

router.put('/trips/:id/cancel', requireRole('admin'), handle(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body.reason ?? '').trim();
  if (id === null) throw new HttpError(404, 'Trip not found');
  if (!reason) throw new HttpError(400, 'A reason is required.');

  const updated = await query(
    `UPDATE trips SET status = 'cancelled', ended_at = now(), cancelled_by = $2, cancel_reason = $3
     WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, req.user.id, reason.slice(0, 200)]
  );
  if (updated.rows.length === 0) {
    const exists = await query('SELECT 1 FROM trips WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new HttpError(404, 'Trip not found');
    throw new HttpError(409, 'Only open trips can be cancelled.');
  }
  const { rows } = await query(`${TRIP_SELECT} WHERE t.id = $1`, [id]);
  res.json({ success: true, trip: rows[0] });
}));

export default router;
