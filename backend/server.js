import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query, withTransaction } from './db/index.js';
import { initDatabase } from './db/init.js';
import { requireAuth, requireRole, signToken, publicUser } from './middleware/auth.js';
import usersRouter from './routes/users.js';
import railRoutesRouter from './routes/railRoutes.js';
import tripsRouter from './routes/trips.js';
import trainsRouter from './routes/trains.js';
import topupsRouter from './routes/topups.js';
import deviceRouter from './routes/device.js';
import cardsRouter from './routes/cards.js';
import devicesRouter from './routes/devices.js';
import { payhereNotify } from './routes/payhereNotify.js';
import { payhereMode } from './lib/payhere.js';
import { formatTxnDate } from './lib/format.js';
import {
  hashPassword,
  verifyPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  PASSWORD_RULE,
  USERNAME_RULE,
} from './lib/passwords.js';
import { parseProfile, conflictMessage } from './lib/profile.js';
import { blockedFor, recordFailure, clearFailures } from './lib/loginThrottle.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
// PayHere posts its payment notification form-encoded; it is verified by md5sig.
app.post('/api/payhere/notify', express.urlencoded({ extended: false }), payhereNotify);
app.use(express.json());

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

// Routes
app.get('/', (req, res) => {
  res.send('SmartRail API Running with PostgreSQL...');
});

app.post('/api/register', asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;

  if (!validateUsername(username)) {
    return res.status(400).json({ success: false, message: USERNAME_RULE });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ success: false, message: PASSWORD_RULE });
  }

  const profile = parseProfile(req.body, { required: true });
  if (profile.error) {
    return res.status(400).json({ success: false, message: profile.error });
  }
  const { fullName, phone, nic, email } = profile.values;

  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO users (username, password_hash, role, balance, full_name, phone, nic, email)
       VALUES ($1, $2, 'user', 0, $3, $4, $5, $6)
       RETURNING id, username, role, balance, status, token_version, full_name, phone, nic, email`,
      [username, await hashPassword(password), fullName, phone, nic, email]
    ));
  } catch (err) {
    const message = conflictMessage(err);
    if (message) return res.status(409).json({ success: false, message });
    throw err;
  }

  res.json({ success: true, user: publicUser(rows[0]), token: signToken(rows[0]) });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = req.body.password;

  const wait = blockedFor(username);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    res.set('Retry-After', String(seconds));
    return res.status(429).json({
      success: false,
      message: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
    });
  }

  const { rows } = await query(
    `SELECT id, username, role, balance, status, token_version, password_hash, full_name, phone, nic, email
     FROM users WHERE username = $1`,
    [username]
  );
  const user = rows[0];
  // Always runs one bcrypt comparison, even for unknown users, so timing is uniform.
  const passwordOk = await verifyPassword(password, user?.password_hash);

  if (!user || !passwordOk || user.status !== 'active') {
    recordFailure(username);
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }

  clearFailures(username);
  res.json({ success: true, user: publicUser(user), token: signToken(user) });
}));

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

app.put('/api/me/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(currentPassword, rows[0]?.password_hash))) {
    return res.status(403).json({ success: false, message: 'Current password is incorrect' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ success: false, message: PASSWORD_RULE });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ success: false, message: 'New password must be different' });
  }

  const updated = await query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now()
     WHERE id = $1 RETURNING id, role, token_version`,
    [req.user.id, await hashPassword(newPassword)]
  );
  res.json({ success: true, token: signToken(updated.rows[0]) });
}));

app.get('/api/history/:userId', requireAuth, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (req.user.role !== 'admin' && userId !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not permitted' });
  }
  if (Number.isNaN(userId)) return res.json({ success: true, history: [] });

  const { rows } = await query(
    `SELECT id, user_id AS "userId", type, title, amount, created_at
     FROM transactions WHERE user_id = $1
     ORDER BY id DESC LIMIT 10`,
    [userId]
  );
  const history = rows.map(({ created_at, ...t }) => ({ ...t, date: formatTxnDate(created_at) }));
  res.json({ success: true, history });
}));

app.use('/api/users', usersRouter);

app.use('/api/routes', railRoutesRouter);
app.use('/api/trains', trainsRouter);
app.use('/api/topups', topupsRouter);
app.use('/api/device', deviceRouter);
app.use('/api/cards', cardsRouter);

// Legacy top-up without payment: off unless ALLOW_DEMO_TOPUP=true (real top-ups go through /api/topups).
app.post('/api/topup', requireAuth, asyncHandler(async (req, res) => {
  if (process.env.ALLOW_DEMO_TOPUP !== 'true') {
    return res.status(403).json({ success: false, message: 'Online payment is required to top up.' });
  }
  if (req.user.role !== 'user') {
    return res.status(403).json({ success: false, message: 'Not permitted' });
  }
  if (req.body.userId !== undefined && Number(req.body.userId) !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Not permitted' });
  }

  const amount = parseAmount(req.body.amount);
  if (amount === null) return res.status(400).json({ success: false, message: 'Invalid amount' });

  const userId = req.user.id;
  const balance = Number.isInteger(userId)
    ? await withTransaction(async (client) => {
        const { rows } = await client.query(
          'UPDATE users SET balance = balance + $2 WHERE id = $1 RETURNING balance',
          [userId, amount]
        );
        if (rows.length === 0) return null;
        await client.query(
          "INSERT INTO transactions (user_id, type, title, amount) VALUES ($1, 'credit', 'Card Recharge', $2)",
          [userId, amount]
        );
        return rows[0].balance;
      })
    : null;

  if (balance === null) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, balance });
}));

// /api/rfid/tap (start/end of trip) and /api/trips live in routes/trips.js
app.use('/api', devicesRouter);
app.use('/api', tripsRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error' });
});

const start = async () => {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set. Add it to backend/.env (see backend/.env.example).');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to backend/.env (see backend/.env.example).');
    process.exit(1);
  }
  try {
    await initDatabase();
  } catch (err) {
    // Connection refusals surface as an AggregateError with an empty message.
    const reason = err.message || err.errors?.[0]?.message || err.code || String(err);
    console.error('Could not initialise the database:', reason);
    process.exit(1);
  }
  const mode = payhereMode();
  console.log(mode === 'unconfigured' ? 'PayHere: not configured (online top-ups unavailable)' : `PayHere mode: ${mode}`);
  app.listen(PORT, () => {
    console.log(`🚀 SmartRail Backend running on http://localhost:${PORT}`);
  });
};

start();
