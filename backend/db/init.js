import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, withTransaction } from './index.js';
import { seedUsers, seedRoutes } from './seed.js';
import { hashPassword, isHashed } from '../lib/passwords.js';
import { setRouteStations } from './stations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

// Keep sequences ahead of explicitly inserted ids.
export const syncSequences = async (client) => {
  for (const table of ['users', 'routes', 'transactions', 'stations', 'trips', 'route_audit', 'topups', 'cards', 'devices', 'tap_events']) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 0), 1), (SELECT COUNT(*) > 0 FROM ${table}))`
    );
  }
};

export const ensureSchema = (client = pool) => client.query(schemaSql);

// One-time conversion of the legacy plaintext `password` column. Safe to repeat: it is a no-op once the column is gone.
const migrateLegacyPasswords = () =>
  withTransaction(async (client) => {
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { rows: cols } = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password' AND table_schema = current_schema()"
    );
    if (cols.length === 0) return;

    const { rows } = await client.query('SELECT id, password, password_hash FROM users');
    for (const u of rows) {
      if (u.password_hash) continue;
      const hash = isHashed(u.password) ? u.password : await hashPassword(u.password);
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, hash]);
    }
    await client.query('ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL');
    await client.query('ALTER TABLE users DROP COLUMN password');
  });

// Hashes any password_hash value that is still readable (e.g. written by hand with a SQL client).
const hashReadablePasswords = async () => {
  const { rows } = await pool.query("SELECT id, password_hash FROM users WHERE password_hash <> ''");
  for (const u of rows) {
    if (isHashed(u.password_hash)) continue;
    await pool.query(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 AND password_hash = $3',
      [u.id, await hashPassword(u.password_hash), u.password_hash]
    );
  }
};

// Converts routes created before fixed fares and stations existed. Idempotent: only touches routes
// that still lack a fare or an ordered station list.
const LEGACY_STATIONS = /^(.+?)\s*\(\s*[\d.]+\s*km\)\s*⇄\s*(.+?)\s*\(\s*[\d.]+\s*km\)\s*$/;

const migrateRoutes = () =>
  withTransaction(async (client) => {
    await client.query('UPDATE routes SET fare = base_fare WHERE fare IS NULL AND base_fare IS NOT NULL');
    await client.query('UPDATE routes SET fare = 0 WHERE fare IS NULL');

    const { rows } = await client.query(
      `SELECT r.id, r.name, r.stations FROM routes r
       WHERE NOT EXISTS (SELECT 1 FROM route_stations rs WHERE rs.route_id = r.id)`
    );
    for (const r of rows) {
      const match = LEGACY_STATIONS.exec(r.stations || '');
      if (!match) {
        console.warn(`Route "${r.name}" has no parseable stations; an Admin must add them.`);
        continue;
      }
      await setRouteStations(client, r.id, [match[1], match[2]]);
    }
    await syncSequences(client);
  });

export const initDatabase = async () => {
  await ensureSchema();
  await migrateLegacyPasswords();
  await hashReadablePasswords();
  await migrateRoutes();

  await withTransaction(async (client) => {
    // Serialise concurrent first starts.
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n > 0) return;

    for (const u of seedUsers) {
      await client.query(
        'INSERT INTO users (id, username, password_hash, role, balance) VALUES ($1, $2, $3, $4, $5)',
        [u.id, u.username, await hashPassword(u.password), u.role, u.balance]
      );
    }
    for (const r of seedRoutes) {
      await client.query('INSERT INTO routes (id, name, fare) VALUES ($1, $2, $3)', [r.id, r.name, r.fare]);
      await setRouteStations(client, r.id, r.stations);
    }
    await syncSequences(client);
  });
};
