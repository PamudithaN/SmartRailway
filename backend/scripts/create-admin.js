// Usage: npm run admin:create -- <username> <password>
// Creates an admin, or resets the password / role / status of an existing account with that username.
import { pool } from '../db/index.js';
import { ensureSchema } from '../db/init.js';
import { hashPassword, validatePassword, validateUsername, PASSWORD_RULE, USERNAME_RULE } from '../lib/passwords.js';

const run = async () => {
  const [username, password] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in backend/.env');
  if (!username || !password) throw new Error('Usage: npm run admin:create -- <username> <password>');
  if (!validateUsername(username)) throw new Error(USERNAME_RULE);
  if (!validatePassword(password)) throw new Error(PASSWORD_RULE);

  await ensureSchema();
  const hash = await hashPassword(password);

  const updated = await pool.query(
    `UPDATE users
       SET password_hash = $2, role = 'admin', status = 'active',
           token_version = token_version + 1, updated_at = now()
     WHERE username = $1 RETURNING id`,
    [username, hash]
  );
  if (updated.rows.length > 0) {
    console.log(`Updated existing account "${username}" (id ${updated.rows[0].id}): now an active admin with the new password.`);
    return;
  }

  const created = await pool.query(
    "INSERT INTO users (username, password_hash, role, balance) VALUES ($1, $2, 'admin', 0) RETURNING id",
    [username, hash]
  );
  console.log(`Created admin "${username}" (id ${created.rows[0].id}).`);
};

run()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
