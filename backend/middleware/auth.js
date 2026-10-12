import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const signToken = (user) =>
  jwt.sign({ role: user.role, tv: user.token_version }, process.env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

// Verifies the bearer token, then reloads the user so status, role and revocation
// come from the database rather than from the token claims.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Not signed in' });
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired' : 'Not signed in';
    return res.status(401).json({ success: false, message });
  }

  const { rows } = await query(
    'SELECT id, username, role, status, balance, token_version, full_name, phone, nic, email FROM users WHERE id = $1',
    [Number(claims.sub)]
  );
  const user = rows[0];
  if (!user || user.status !== 'active' || user.token_version !== claims.tv) {
    return res.status(401).json({ success: false, message: 'Session expired' });
  }

  req.user = user;
  next();
});

export const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) {
    return res.status(403).json({ success: false, message: 'Not permitted' });
  }
  next();
};

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  balance: u.balance || 0,
  status: u.status,
  fullName: u.full_name ?? null,
  phone: u.phone ?? null,
  nic: u.nic ?? null,
  email: u.email ?? null,
});
