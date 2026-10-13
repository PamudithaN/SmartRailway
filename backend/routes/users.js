import express from 'express';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parseProfile, conflictMessage } from '../lib/profile.js';
import {
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  PASSWORD_RULE,
  USERNAME_RULE,
} from '../lib/passwords.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const USER_COLUMNS =
  'id, username, role, balance, status, full_name AS "fullName", phone, nic, email, created_at AS "createdAt"';
const ROLES = ['user', 'admin', 'station_master'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    const conflict = conflictMessage(err);
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    next(err);
  }
};

const parseId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'User not found');
  return id;
};

// Locks all active admins so two concurrent requests can't each remove "the other" admin.
const lockActiveAdmins = async (client) => {
  const { rows } = await client.query(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE"
  );
  return rows.map((r) => r.id);
};

const lockTarget = async (client, id) => {
  const { rows } = await client.query(
    "SELECT id, username, role, status, balance FROM users WHERE id = $1 AND status <> 'deleted' FOR UPDATE",
    [id]
  );
  if (rows.length === 0) throw new HttpError(404, 'User not found');
  return rows[0];
};

const isLastActiveAdmin = (target, activeAdminIds) =>
  target.role === 'admin' && target.status === 'active' && activeAdminIds.length <= 1;

router.get('/', handle(async (req, res) => {
  const params = [];
  const where = ["status <> 'deleted'"];
  if (typeof req.query.role === 'string' && ROLES.includes(req.query.role)) {
    params.push(req.query.role);
    where.push(`role = $${params.length}`);
  }
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    params.push(`%${req.query.search.trim().replace(/[\%_]/g, '\$&')}%`);
    where.push(
      `(username ILIKE $${params.length} OR full_name ILIKE $${params.length} OR email ILIKE $${params.length}
        OR phone ILIKE $${params.length} OR nic ILIKE $${params.length})`
    );
  }
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users WHERE ${where.join(' AND ')} ORDER BY id`,
    params
  );
  res.json({ success: true, users: rows });
}));

router.post('/', handle(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;
  const role = req.body.role === undefined ? 'user' : req.body.role;

  if (!validateUsername(username)) throw new HttpError(400, USERNAME_RULE);
  if (!validatePassword(password)) throw new HttpError(400, PASSWORD_RULE);
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');

  // Contact details are optional for Admin-created accounts, but validated when given.
  const profile = parseProfile(req.body);
  if (profile.error) throw new HttpError(400, profile.error);
  const { fullName = null, phone = null, nic = null, email = null } = profile.values;

  const { rows } = await query(
    `INSERT INTO users (username, password_hash, role, balance, full_name, phone, nic, email)
     VALUES ($1, $2, $3, 0, $4, $5, $6, $7) RETURNING ${USER_COLUMNS}`,
    [username, await hashPassword(password), role, fullName, phone, nic, email]
  );
  res.status(201).json({ success: true, user: rows[0] });
}));

router.put('/:id', handle(async (req, res) => {
  const id = parseId(req);
  const hasUsername = req.body.username !== undefined;
  const hasRole = req.body.role !== undefined;

  const profile = parseProfile(req.body);
  if (profile.error) throw new HttpError(400, profile.error);
  const p = profile.values;
  const hasProfile = Object.keys(p).length > 0;
  if (!hasUsername && !hasRole && !hasProfile) throw new HttpError(400, 'Nothing to update');

  const username = hasUsername ? normalizeUsername(req.body.username) : null;
  if (hasUsername && !validateUsername(username)) throw new HttpError(400, USERNAME_RULE);
  if (hasRole && !ROLES.includes(req.body.role)) throw new HttpError(400, 'Invalid role');

  const user = await withTransaction(async (client) => {
    const activeAdmins = await lockActiveAdmins(client);
    const target = await lockTarget(client, id);

    if (hasRole && req.body.role !== target.role) {
      if (target.id === req.user.id) throw new HttpError(409, 'Cannot change your own role');
      if (isLastActiveAdmin(target, activeAdmins)) {
        throw new HttpError(409, 'Cannot demote the last active admin');
      }
    }

    const { rows } = await client.query(
      `UPDATE users
         SET username = COALESCE($2, username),
             role = COALESCE($3::text, role),
             full_name = COALESCE($4::text, full_name),
             phone = COALESCE($5::text, phone),
             nic = COALESCE($6::text, nic),
             email = COALESCE($7::text, email),
             token_version = token_version + CASE WHEN $3::text IS NOT NULL AND $3::text <> role THEN 1 ELSE 0 END,
             updated_at = now()
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, username, hasRole ? req.body.role : null, p.fullName ?? null, p.phone ?? null, p.nic ?? null, p.email ?? null]
    );
    return rows[0];
  });
  res.json({ success: true, user });
}));

router.put('/:id/status', handle(async (req, res) => {
  const id = parseId(req);
  const { status } = req.body;
  if (status !== 'active' && status !== 'deactivated') throw new HttpError(400, 'Invalid status');

  const user = await withTransaction(async (client) => {
    const activeAdmins = await lockActiveAdmins(client);
    const target = await lockTarget(client, id);

    if (status === 'deactivated') {
      if (target.id === req.user.id) throw new HttpError(409, 'Cannot deactivate your own account');
      if (isLastActiveAdmin(target, activeAdmins)) {
        throw new HttpError(409, 'Cannot deactivate the last active admin');
      }
    }

    const { rows } = await client.query(
      `UPDATE users
         SET status = $2::text,
             token_version = token_version + CASE WHEN $2::text = 'deactivated' THEN 1 ELSE 0 END,
             updated_at = now()
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, status]
    );
    return rows[0];
  });
  res.json({ success: true, user });
}));

router.post('/:id/reset-password', handle(async (req, res) => {
  const id = parseId(req);
  if (!validatePassword(req.body.newPassword)) throw new HttpError(400, PASSWORD_RULE);
  const hash = await hashPassword(req.body.newPassword);

  const { rowCount } = await query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now()
     WHERE id = $1 AND status <> 'deleted'`,
    [id, hash]
  );
  if (rowCount === 0) throw new HttpError(404, 'User not found');
  res.json({ success: true });
}));

// Anonymising soft delete: the row stays so past Transactions keep a valid owner.
router.delete('/:id', handle(async (req, res) => {
  const id = parseId(req);

  await withTransaction(async (client) => {
    const activeAdmins = await lockActiveAdmins(client);
    const target = await lockTarget(client, id);

    if (target.id === req.user.id) throw new HttpError(409, 'Cannot delete your own account');
    if (isLastActiveAdmin(target, activeAdmins)) {
      throw new HttpError(409, 'Cannot delete the last active admin');
    }
    if (Number(target.balance) !== 0) {
      throw new HttpError(409, 'Balance must be zero before deleting');
    }

    await client.query(
      `UPDATE users
         SET status = 'deleted', username = $2, password_hash = '',
             full_name = NULL, phone = NULL, nic = NULL, email = NULL,
             token_version = token_version + 1, updated_at = now()
       WHERE id = $1`,
      [id, `deleted-${id}`]
    );
  });
  res.json({ success: true });
}));

export default router;
