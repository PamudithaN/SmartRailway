import express from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';

const router = express.Router();
router.use(requireAuth);

const timeoutSeconds = () => {
  const n = Number(process.env.TRAIN_SIGNAL_TIMEOUT_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 300;
};

router.get('/', handle(async (req, res) => {
  const { rows } = await query(
    `SELECT p.train_no AS "trainNo", p.train_name AS name, p.route_id AS "routeId", r.name AS "routeName",
            p.latitude, p.longitude, p.speed_kmh AS "speedKmh", p.reported_at AS "reportedAt",
            (now() - p.reported_at) <= make_interval(secs => $1::int) AS live
     FROM train_positions p
     LEFT JOIN routes r ON r.id = p.route_id
     ORDER BY p.train_no`,
    [timeoutSeconds()]
  );
  const trains = rows.map(({ live, ...t }) => ({
    ...t,
    signal: live ? 'live' : 'no_signal',
    status: !live ? 'no_signal' : t.speedKmh > 0 ? 'running' : 'stopped',
  }));
  res.json({ success: true, trains });
}));

// GPS feed. Admin-authenticated like the RFID bridge; device authentication is not designed yet.
router.post('/position', requireRole('admin'), handle(async (req, res) => {
  const trainNo = String(req.body.trainNo ?? '').trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const speed = req.body.speedKmh === undefined || req.body.speedKmh === null ? null : Number(req.body.speedKmh);
  const routeId = req.body.routeId === undefined || req.body.routeId === null ? null : Number(req.body.routeId);

  if (!trainNo) throw new HttpError(400, 'trainNo is required.');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(400, 'Invalid coordinates.');
  }
  if (speed !== null && (!Number.isFinite(speed) || speed < 0)) throw new HttpError(400, 'Invalid speed.');
  if (routeId !== null) {
    if (!Number.isInteger(routeId)) throw new HttpError(404, 'Route not found');
    const found = await query('SELECT 1 FROM routes WHERE id = $1', [routeId]);
    if (found.rows.length === 0) throw new HttpError(404, 'Route not found');
  }

  await query(
    `INSERT INTO train_positions (train_no, train_name, route_id, latitude, longitude, speed_kmh, reported_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (train_no) DO UPDATE SET
       train_name = COALESCE(EXCLUDED.train_name, train_positions.train_name),
       route_id = COALESCE(EXCLUDED.route_id, train_positions.route_id),
       latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
       speed_kmh = EXCLUDED.speed_kmh, reported_at = now()`,
    [trainNo, req.body.name ? String(req.body.name).trim() : null, routeId, latitude, longitude, speed]
  );
  res.json({ success: true });
}));

export default router;
