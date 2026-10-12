import express from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parseRouteInput } from '../lib/routeInput.js';
import { formatTxnDate } from '../lib/format.js';
import { HttpError, handle } from '../lib/http.js';
import { setRouteStations } from '../db/stations.js';

const router = express.Router();
router.use(requireAuth);

// Routes with their ordered stations. `client` lets callers read inside a transaction.
export const loadRoutes = async (client, { id = null, activeOnly = false } = {}) => {
  const { rows } = await client.query(
    `SELECT r.id, r.name, r.fare, r.status, r.version,
            COALESCE(
              json_agg(json_build_object('id', s.id, 'name', s.name, 'position', rs.position)
                       ORDER BY rs.position) FILTER (WHERE s.id IS NOT NULL),
              '[]'::json
            ) AS stations
     FROM routes r
     LEFT JOIN route_stations rs ON rs.route_id = r.id
     LEFT JOIN stations s ON s.id = rs.station_id
     WHERE ($1::int IS NULL OR r.id = $1) AND (NOT $2::boolean OR r.status = 'active')
     GROUP BY r.id
     ORDER BY r.id`,
    [id, activeOnly]
  );
  return rows;
};

const parseId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Route not found');
  return id;
};

router.get('/', handle(async (req, res) => {
  const routes = await loadRoutes({ query }, { activeOnly: req.user.role !== 'admin' });
  res.json({ success: true, routes });
}));

router.get('/history', requireRole('admin'), handle(async (req, res) => {
  const routeId = req.query.routeId === undefined ? null : parseId(req.query.routeId);
  const { rows } = await query(
    `SELECT a.id, a.route_id AS "routeId", r.name AS "routeName", u.username AS admin,
            a.action, a.old_values AS "oldValues", a.new_values AS "newValues", a.created_at
     FROM route_audit a
     JOIN routes r ON r.id = a.route_id
     LEFT JOIN users u ON u.id = a.admin_id
     WHERE ($1::int IS NULL OR a.route_id = $1)
     ORDER BY a.id DESC LIMIT 100`,
    [routeId]
  );
  const history = rows.map(({ created_at, ...h }) => ({ ...h, date: formatTxnDate(created_at) }));
  res.json({ success: true, history });
}));

router.post('/', requireRole('admin'), handle(async (req, res) => {
  const parsed = parseRouteInput(req.body);
  if (parsed.error) throw new HttpError(400, parsed.error);
  const { name, fare, stations } = parsed.values;

  const route = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO routes (name, fare) VALUES ($1, $2) RETURNING id',
      [name, fare]
    );
    const id = rows[0].id;
    await setRouteStations(client, id, stations);
    await client.query(
      "INSERT INTO route_audit (route_id, admin_id, action, new_values) VALUES ($1, $2, 'create', $3)",
      [id, req.user.id, JSON.stringify({ name, fare, status: 'active', stations })]
    );
    return (await loadRoutes(client, { id }))[0];
  });
  res.json({ success: true, route });
}));

router.put('/:id', requireRole('admin'), handle(async (req, res) => {
  const id = parseId(req.params.id);
  const version = Number(req.body.version);
  if (!Number.isInteger(version)) throw new HttpError(400, 'Route version is required.');

  const parsed = parseRouteInput(req.body, { partial: true });
  if (parsed.error) throw new HttpError(400, parsed.error);
  const changes = parsed.values;

  const route = await withTransaction(async (client) => {
    const current = (await client.query('SELECT version FROM routes WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!current) throw new HttpError(404, 'Route not found');
    if (current.version !== version) {
      throw new HttpError(409, 'This Route was changed by someone else. Reload and try again.');
    }

    const before = (await loadRoutes(client, { id }))[0];
    const oldValues = {};
    const newValues = {};
    for (const key of ['name', 'fare', 'status']) {
      if (changes[key] !== undefined && changes[key] !== before[key]) {
        oldValues[key] = before[key];
        newValues[key] = changes[key];
      }
    }

    if (changes.stations) {
      const oldNames = before.stations.map((s) => s.name);
      if (JSON.stringify(oldNames) !== JSON.stringify(changes.stations)) {
        const keep = new Set(changes.stations.map((n) => n.toLowerCase()));
        const removed = before.stations.filter((s) => !keep.has(s.name.toLowerCase())).map((s) => s.id);
        if (removed.length > 0) {
          const open = await client.query(
            "SELECT 1 FROM trips WHERE route_id = $1 AND status = 'open' AND start_station_id = ANY($2) LIMIT 1",
            [id, removed]
          );
          if (open.rows.length > 0) {
            throw new HttpError(409, 'A Station you removed has an open trip. Complete or cancel it first.');
          }
        }
        oldValues.stations = oldNames;
        newValues.stations = changes.stations;
        await setRouteStations(client, id, changes.stations);
      }
    }

    const keys = Object.keys(newValues);
    if (keys.length > 0) {
      await client.query(
        `UPDATE routes SET name = COALESCE($2, name), fare = COALESCE($3, fare),
                status = COALESCE($4, status), version = version + 1, updated_at = now()
         WHERE id = $1`,
        [id, newValues.name ?? null, newValues.fare ?? null, newValues.status ?? null]
      );
      const action = keys.length === 1 && ['fare', 'status', 'stations'].includes(keys[0]) ? keys[0] : 'update';
      await client.query(
        'INSERT INTO route_audit (route_id, admin_id, action, old_values, new_values) VALUES ($1, $2, $3, $4, $5)',
        [id, req.user.id, action, JSON.stringify(oldValues), JSON.stringify(newValues)]
      );
    }
    return (await loadRoutes(client, { id }))[0];
  });
  res.json({ success: true, route });
}));

export default router;
