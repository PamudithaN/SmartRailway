import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, withTransaction } from '../db/index.js';
import { ensureSchema, syncSequences } from '../db/init.js';
import { hashPassword, isHashed } from '../lib/passwords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data.json');

const run = async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in backend/.env');
  if (!fs.existsSync(DATA_PATH)) throw new Error(`No data.json found at ${DATA_PATH}`);

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  await ensureSchema();

  const counts = await withTransaction(async (client) => {
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      throw new Error('Database already contains users. Import only runs on an empty database; drop and recreate it first.');
    }

    for (const u of data.users || []) {
      await client.query(
        'INSERT INTO users (id, username, password_hash, role, balance) VALUES ($1, $2, $3, $4, $5)',
        [u.id, u.username, isHashed(u.password) ? u.password : await hashPassword(u.password), u.role, u.balance || 0]
      );
    }
    for (const r of data.routes || []) {
      await client.query(
        'INSERT INTO routes (id, name, stations, base_fare, per_km, total_km) VALUES ($1, $2, $3, $4, $5, $6)',
        [r.id, r.name, r.stations, r.baseFare, r.perKm, r.totalKm]
      );
    }
    for (const t of data.transactions || []) {
      // Legacy ids are Date.now() milliseconds, so they double as the creation time.
      await client.query(
        `INSERT INTO transactions (id, user_id, type, title, amount, created_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($1 / 1000.0))`,
        [t.id, t.userId, t.type, t.title, t.amount]
      );
    }
    await syncSequences(client);

    return {
      users: (data.users || []).length,
      routes: (data.routes || []).length,
      transactions: (data.transactions || []).length,
    };
  });

  console.log(`Imported ${counts.users} users, ${counts.routes} routes, ${counts.transactions} transactions.`);
};

run()
  .catch((err) => {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
