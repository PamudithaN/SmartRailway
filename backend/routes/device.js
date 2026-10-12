import express from 'express';
import { query, withTransaction } from '../db/index.js';
import { HttpError, errorBody } from '../lib/http.js';
import { requireDevice } from '../lib/deviceAuth.js';
import { applyTap } from '../lib/tap.js';

const router = express.Router();

const asText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Reader taps: authenticated by device key, bound to the device's Route and Station.
router.post('/tap', requireDevice, async (req, res, next) => {
  const { device } = req;
  const cardUid = asText(req.body.cardUid, 64);
  const eventId = asText(req.body.eventId, 100);
  const rawAction = req.body.action;
  let action = null;

  try {
    if (!cardUid || !eventId) throw new HttpError(400, 'cardUid and eventId are required.', 'bad_request');
    if (rawAction !== undefined && rawAction !== null && rawAction !== 'start' && rawAction !== 'end') {
      throw new HttpError(400, 'Tap action must be start or end.', 'bad_request');
    }
    action = rawAction ?? null;

    const outcome = await withTransaction(async (client) => {
      const claimed = await client.query(
        `INSERT INTO tap_events (device_id, event_id, card_uid, action, outcome, http_status)
         VALUES ($1, $2, $3, $4, 'accepted', 200)
         ON CONFLICT (device_id, event_id) WHERE device_id IS NOT NULL AND event_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [device.id, eventId, cardUid, action]
      );
      if (claimed.rows.length === 0) {
        const prior = await client.query(
          'SELECT response, http_status FROM tap_events WHERE device_id = $1 AND event_id = $2',
          [device.id, eventId]
        );
        return { replay: prior.rows[0] };
      }

      const card = (await client.query(
        'SELECT user_id, status FROM cards WHERE upper(uid) = upper($1)',
        [cardUid]
      )).rows[0];
      if (!card) throw new HttpError(404, 'Card is not registered.', 'unknown_card');
      if (card.status !== 'active') throw new HttpError(403, 'Card is blocked.', 'card_blocked');

      const result = await applyTap(client, {
        userId: card.user_id,
        routeId: device.route_id,
        stationId: device.station_id,
        action,
        source: 'reader',
        deviceId: device.id,
      });
      const body = { success: true, ...result };
      await client.query(
        `UPDATE tap_events SET user_id = $2, action = $3, outcome = 'accepted', response = $4
         WHERE id = $1`,
        [claimed.rows[0].id, card.user_id, result.code === 'trip_started' ? 'start' : 'end', body]
      );
      return { body };
    });

    if (outcome.replay) {
      res.set('Idempotent-Replay', 'true');
      return res.status(outcome.replay.http_status || 200).json(outcome.replay.response);
    }
    res.json(outcome.body);
  } catch (err) {
    if (!(err instanceof HttpError)) return next(err);
    const body = { ...errorBody(err), eventId: eventId || undefined };
    try {
      // Rejections are logged without event_id so the reader can retry the same tap after fixing the cause.
      await query(
        `INSERT INTO tap_events (device_id, card_uid, action, outcome, http_status, response)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [device.id, cardUid || null, action, err.code || 'rejected', err.status, body]
      );
    } catch (logErr) {
      console.error('Could not record rejected tap:', logErr.message);
    }
    res.status(err.status).json(body);
  }
});

export default router;
