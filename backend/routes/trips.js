import crypto from 'crypto';
import express from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requireRole, requireAnyRole } from '../middleware/auth.js';
import { HttpError, handle } from '../lib/http.js';
import { applyTap, debitTripFare } from '../lib/tap.js';

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

// The Passenger's own trips; the QR token is only exposed here, and only while it awaits scanning.
router.get('/trips/mine', handle(async (req, res) => {
  const { rows } = await query(
    `${TRIP_SELECT.replace('t.start_source AS', `CASE WHEN t.status = 'ended' THEN t.qr_token END AS "qrToken",
         t.start_source AS`)}
     WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT 20`,
    [req.user.id]
  );
  res.json({ success: true, trips: rows });
}));

// Passenger ends the trip while travelling: the full fare is debited now, even if the trip is
// ended before the destination, and a QR code is issued for the Station Master to scan.
router.post('/trips/:id/end', requireRole('user'), handle(async (req, res) => {
  const id = toId(req.params.id);
  if (id === null) throw new HttpError(404, 'Trip not found');

  const result = await withTransaction(async (client) => {
    // Same lock order as applyTap: user row first, then the trip.
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const trip = (await client.query(
      `SELECT t.id, t.status, t.fare, t.route_id, t.start_station_id, r.name AS route_name, ss.name AS start_name
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN stations ss ON ss.id = t.start_station_id
       WHERE t.id = $1 AND t.user_id = $2 FOR UPDATE OF t`,
      [id, req.user.id]
    )).rows[0];
    if (!trip) throw new HttpError(404, 'Trip not found');
    if (trip.status !== 'open') throw new HttpError(409, 'This trip has already ended.', 'trip_not_open');

    const charge = await debitTripFare(client, {
      userId: req.user.id,
      fare: trip.fare,
      title: `Trip: ${trip.route_name} (from ${trip.start_name})`,
    });
    const qrToken = crypto.randomBytes(24).toString('base64url');
    const { rows } = await client.query(
      `UPDATE trips SET status = 'ended', ended_at = now(), transaction_id = $2, qr_token = $3
       WHERE id = $1 RETURNING ended_at AS "endedAt"`,
      [id, charge.transactionId, qrToken]
    );
    const balance = charge.balance ?? (await client.query('SELECT balance FROM users WHERE id = $1', [req.user.id])).rows[0].balance;
    return { qrToken, endedAt: rows[0].endedAt, balance, trip };
  });

  res.json({
    success: true,
    message: 'Trip ended. Show the QR code to the Station Master.',
    trip: { id, fare: result.trip.fare, status: 'ended', routeId: result.trip.route_id, qrToken: result.qrToken, endedAt: result.endedAt },
    newBalance: result.balance,
  });
}));

// Station Master (or Admin) scans the Passenger's QR: shows the payment and trip details.
router.post('/trips/scan', requireAnyRole('station_master', 'admin'), handle(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 200) throw new HttpError(400, 'A QR code is required.');

  const { tripId, alreadyScanned } = await withTransaction(async (client) => {
    const trip = (await client.query(
      'SELECT id, status FROM trips WHERE qr_token = $1 FOR UPDATE',
      [token]
    )).rows[0];
    if (!trip) throw new HttpError(404, 'QR code not recognised.', 'unknown_qr');
    if (trip.status === 'completed') return { tripId: trip.id, alreadyScanned: true };
    if (trip.status !== 'ended') throw new HttpError(409, 'This trip is not ready to be verified.', 'trip_not_ended');

    await client.query(
      "UPDATE trips SET status = 'completed', scanned_at = now(), scanned_by = $2 WHERE id = $1",
      [trip.id, req.user.id]
    );
    return { tripId: trip.id, alreadyScanned: false };
  });

  const { rows } = await query(
    `SELECT t.id, t.user_id AS "userId", t.fare, t.status, t.started_at AS "startedAt", t.ended_at AS "endedAt",
            t.scanned_at AS "scannedAt", t.transaction_id AS "transactionId",
            u.username, u.full_name AS "fullName", r.name AS "routeName", ss.name AS "startStation"
     FROM trips t
     JOIN users u ON u.id = t.user_id
     JOIN routes r ON r.id = t.route_id
     JOIN stations ss ON ss.id = t.start_station_id
     WHERE t.id = $1`,
    [tripId]
  );
  res.json({ success: true, alreadyScanned, payment: 'paid', trip: rows[0] });
}));

router.get('/trips', requireRole('admin'), handle(async (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !['open', 'ended', 'completed', 'cancelled'].includes(status)) {
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
