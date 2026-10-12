import express from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';
import { generateDeviceKey, hashDeviceKey } from '../lib/deviceAuth.js';

// Mounted at /api; guards are per route so it never intercepts /api/device/tap.
const router = express.Router();
const admin = [requireAuth, requireRole('admin')];

const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const DEVICE_SELECT = `
  SELECT d.id, d.name, d.status, d.route_id AS "routeId", r.name AS "routeName",
         d.station_id AS "stationId", s.name AS "stationName",
         d.last_seen_at AS "lastSeenAt", d.created_at AS "createdAt"
  FROM devices d
  JOIN routes r ON r.id = d.route_id
  JOIN stations s ON s.id = d.station_id`;

router.get('/devices', ...admin, handle(async (req, res) => {
  const { rows } = await query(`${DEVICE_SELECT} ORDER BY d.id DESC`);
  res.json({ success: true, devices: rows });
}));

router.post('/devices', ...admin, handle(async (req, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 80);
  const routeId = toId(req.body.routeId);
  const stationId = toId(req.body.stationId);
  if (!name) throw new HttpError(400, 'Device name is required.');
  if (routeId === null || stationId === null) throw new HttpError(400, 'Route and Station are required.');

  const onRoute = await query(
    'SELECT 1 FROM route_stations WHERE route_id = $1 AND station_id = $2',
    [routeId, stationId]
  );
  if (onRoute.rows.length === 0) throw new HttpError(400, 'Station is not on this Route.');

  const key = generateDeviceKey();
  const { rows } = await query(
    'INSERT INTO devices (name, key_hash, route_id, station_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, hashDeviceKey(key), routeId, stationId]
  );
  const device = (await query(`${DEVICE_SELECT} WHERE d.id = $1`, [rows[0].id])).rows[0];
  // The plain key is shown once and never stored.
  res.json({ success: true, device, key });
}));

router.put('/devices/:id/status', ...admin, handle(async (req, res) => {
  const id = toId(req.params.id);
  const { status } = req.body;
  if (status !== 'active' && status !== 'disabled') throw new HttpError(400, 'Status must be active or disabled.');
  const updated = id === null ? { rows: [] } : await query('UPDATE devices SET status = $2 WHERE id = $1 RETURNING id', [id, status]);
  if (updated.rows.length === 0) throw new HttpError(404, 'Device not found');
  res.json({ success: true, device: (await query(`${DEVICE_SELECT} WHERE d.id = $1`, [id])).rows[0] });
}));

router.post('/devices/:id/rotate-key', ...admin, handle(async (req, res) => {
  const id = toId(req.params.id);
  const key = generateDeviceKey();
  const updated = id === null ? { rows: [] } : await query('UPDATE devices SET key_hash = $2 WHERE id = $1 RETURNING id', [id, hashDeviceKey(key)]);
  if (updated.rows.length === 0) throw new HttpError(404, 'Device not found');
  res.json({ success: true, device: (await query(`${DEVICE_SELECT} WHERE d.id = $1`, [id])).rows[0], key });
}));

router.get('/rfid/events', ...admin, handle(async (req, res) => {
  const outcome = typeof req.query.outcome === 'string' && req.query.outcome ? req.query.outcome : null;
  const { rows } = await query(
    `SELECT e.id, e.device_id AS "deviceId", d.name AS "deviceName", e.card_uid AS "cardUid",
            e.user_id AS "userId", e.action, e.outcome, e.http_status AS "httpStatus", e.created_at AS "createdAt"
     FROM tap_events e LEFT JOIN devices d ON d.id = e.device_id
     WHERE ($1::text IS NULL OR e.outcome = $1) AND ($1::text IS NOT NULL OR e.outcome <> 'accepted')
     ORDER BY e.id DESC LIMIT 100`,
    [outcome]
  );
  res.json({ success: true, events: rows });
}));

export default router;
