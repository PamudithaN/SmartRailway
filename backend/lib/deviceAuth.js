import crypto from 'crypto';
import { query } from '../db/index.js';

// Keys are 32 random bytes, so a fast unsalted hash is sufficient.
export const hashDeviceKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

export const generateDeviceKey = () => `sr_dev_${crypto.randomBytes(32).toString('hex')}`;

// Authenticates a reader by X-Device-Key; sets req.device. Disabled devices are rejected and recorded.
export const requireDevice = async (req, res, next) => {
  try {
    const key = req.get('x-device-key');
    if (!key) {
      return res.status(401).json({ success: false, code: 'unknown_device', message: 'Unknown device' });
    }
    const { rows } = await query(
      'SELECT id, name, route_id, station_id, status FROM devices WHERE key_hash = $1',
      [hashDeviceKey(key)]
    );
    const device = rows[0];
    if (!device) {
      console.warn('Rejected tap from unknown device key');
      return res.status(401).json({ success: false, code: 'unknown_device', message: 'Unknown device' });
    }
    await query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);

    if (device.status !== 'active') {
      const body = { success: false, code: 'device_disabled', message: 'Device is disabled' };
      await query(
        `INSERT INTO tap_events (device_id, card_uid, outcome, http_status, response)
         VALUES ($1, $2, 'device_disabled', 403, $3)`,
        [device.id, typeof req.body?.cardUid === 'string' ? req.body.cardUid.slice(0, 64) : null, body]
      );
      return res.status(403).json(body);
    }
    req.device = device;
    next();
  } catch (err) {
    next(err);
  }
};
