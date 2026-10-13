import { HttpError } from './http.js';

// Station must be on the route's ordered list; returns its name or null.
export const stationOnRoute = async (client, routeId, stationId) => {
  const { rows } = await client.query(
    `SELECT s.name FROM route_stations rs JOIN stations s ON s.id = rs.station_id
     WHERE rs.route_id = $1 AND rs.station_id = $2`,
    [routeId, stationId]
  );
  return rows[0]?.name ?? null;
};

// Debits the full trip fare and records the transaction. Must run inside a transaction.
// A zero fare debits nothing and returns { transactionId: null, balance: null }.
export const debitTripFare = async (client, { userId, fare, title }) => {
  if (!(fare > 0)) return { transactionId: null, balance: null };
  const debited = await client.query(
    'UPDATE users SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
    [userId, fare]
  );
  if (debited.rows.length === 0) throw new HttpError(402, 'Insufficient funds', 'insufficient_funds');
  const { id } = (await client.query(
    "INSERT INTO transactions (user_id, type, title, amount) VALUES ($1, 'debit', $2, $3) RETURNING id",
    [userId, title, fare]
  )).rows[0];
  return { transactionId: id, balance: debited.rows[0].balance };
};

// Shared start/end tap engine used by the Admin simulator and by reader devices.
// Must run inside a transaction. `source` is 'admin' or 'reader'.
// When `action` is null it is inferred: an open trip means end, otherwise start.
export const applyTap = async (client, { userId, routeId, stationId, action, source, deviceId = null }) => {
  const card = (await client.query('SELECT status, balance FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
  if (!card || card.status === 'deleted') throw new HttpError(404, 'RFID unregistered', 'unknown_card');
  if (card.status !== 'active') throw new HttpError(403, 'Card deactivated', 'card_blocked');

  const route = (await client.query('SELECT id, name, fare, status FROM routes WHERE id = $1', [routeId])).rows[0];
  if (!route) throw new HttpError(404, 'Route not found', 'unknown_route');
  const stationName = await stationOnRoute(client, routeId, stationId);
  if (stationName === null) throw new HttpError(400, 'Station is not on this Route.', 'unknown_station');

  if (action === null) {
    const open = await client.query("SELECT 1 FROM trips WHERE user_id = $1 AND status = 'open'", [userId]);
    action = open.rows.length > 0 ? 'end' : 'start';
  }

  if (action === 'start') {
    if (route.status !== 'active') throw new HttpError(409, 'This Route is not in service.', 'route_inactive');
    if (card.balance < route.fare) throw new HttpError(402, 'Insufficient funds', 'insufficient_funds');

    let trip;
    try {
      trip = (await client.query(
        `INSERT INTO trips (user_id, route_id, start_station_id, fare, start_source)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, fare, status`,
        [userId, routeId, stationId, route.fare, source]
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Card already has an open trip.', 'open_trip_exists');
      throw err;
    }
    return { code: 'trip_started', message: 'Trip started', trip: { ...trip, routeId }, balance: card.balance };
  }

  const open = (await client.query(
    "SELECT id, route_id, start_station_id, fare FROM trips WHERE user_id = $1 AND status = 'open' FOR UPDATE",
    [userId]
  )).rows[0];
  if (!open) throw new HttpError(409, 'No open trip for this Card.', 'no_open_trip');
  if (open.route_id !== routeId) throw new HttpError(409, 'Open trip is on a different Route.', 'route_mismatch');
  if (open.start_station_id === stationId) {
    throw new HttpError(400, 'End Station must differ from the start Station.', 'same_station');
  }

  const startName = await stationOnRoute(client, routeId, open.start_station_id);
  const charge = await debitTripFare(client, {
    userId,
    fare: open.fare,
    title: `Trip: ${route.name} (${startName} → ${stationName})`,
  });
  const transactionId = charge.transactionId;
  const balance = charge.balance ?? card.balance;

  await client.query(
    `UPDATE trips SET status = 'completed', end_station_id = $2, ended_at = now(), transaction_id = $3,
            end_source = $4, device_id = $5
     WHERE id = $1`,
    [open.id, stationId, transactionId, source, deviceId]
  );
  return {
    code: 'trip_completed',
    message: 'Trip completed',
    trip: { id: open.id, fare: open.fare, status: 'completed', routeId },
    newBalance: balance,
  };
};
