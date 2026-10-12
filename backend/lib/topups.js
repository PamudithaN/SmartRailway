import { query, withTransaction } from '../db/index.js';
import { HttpError } from './http.js';
import {
  isConfigured, checkoutUrl, checkoutHash, formatAmount, merchantId, hasRetrievalApi, findPaidPayment,
} from './payhere.js';

const CURRENCY = 'LKR';

export const limits = () => ({
  min: Number(process.env.TOPUP_MIN) || 500,
  max: Number(process.env.TOPUP_MAX) || 50000,
});

const pendingMinutes = () => Math.max(30, Number(process.env.TOPUP_PENDING_MINUTES) || 30);
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
// PayHere calls this server-to-server, so it must be publicly reachable (use a tunnel such as ngrok locally).
const notifyUrl = () =>
  process.env.PAYHERE_NOTIFY_URL
  || `${(process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '')}/api/payhere/notify`;

export const TOPUP_COLUMNS = `id, amount, status, failure_reason AS "failureReason", created_at AS "createdAt"`;

// Whole rupees within the configured limits.
export const validateAmount = (value) => {
  const { min, max } = limits();
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new HttpError(400, 'Enter a whole number of rupees.');
  }
  if (amount < min || amount > max) {
    throw new HttpError(400, `Top-up amount must be between Rs. ${min} and Rs. ${max}.`);
  }
  return amount;
};

// Creates a pending attempt and the signed form fields the browser posts to PayHere's hosted checkout.
export const createTopup = async (user, rawAmount) => {
  if (!isConfigured()) throw new HttpError(503, 'Online payments are unavailable.', 'payments_unavailable');
  const amount = validateAmount(rawAmount);

  const recent = await query(
    "SELECT COUNT(*)::int AS n FROM topups WHERE user_id = $1 AND status = 'pending' AND created_at > now() - interval '1 hour'",
    [user.id]
  );
  if (recent.rows[0].n >= 5) {
    throw new HttpError(429, 'Too many unfinished top-ups. Complete or cancel one first.');
  }

  const { rows } = await query(
    `INSERT INTO topups (user_id, amount, currency, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval) RETURNING id`,
    [user.id, amount, CURRENCY, String(pendingMinutes())]
  );
  const id = rows[0].id;
  const orderId = String(id);

  const [firstName, ...rest] = (user.full_name || user.username).trim().split(/\s+/);
  const fields = {
    merchant_id: merchantId(),
    return_url: `${frontendUrl()}/dashboard?topup=success&id=${id}`,
    cancel_url: `${frontendUrl()}/dashboard?topup=cancelled&id=${id}`,
    notify_url: notifyUrl(),
    order_id: orderId,
    items: `SmartRail top-up Rs. ${amount}`,
    currency: CURRENCY,
    amount: formatAmount(amount),
    first_name: firstName,
    last_name: rest.join(' ') || user.username,
    email: user.email || `${user.username}@smartrail.local`,
    phone: user.phone || '0000000000',
    address: 'N/A',
    city: 'Colombo',
    country: 'Sri Lanka',
  };
  fields.hash = checkoutHash({ orderId, amount, currency: CURRENCY });

  return { topup: { id, amount, status: 'pending' }, checkout: { url: checkoutUrl(), fields } };
};

const markReview = (client, topupId, reason) =>
  client.query(
    "UPDATE topups SET status = 'review', failure_reason = $2, updated_at = now() WHERE id = $1",
    [topupId, reason]
  );

// Credits the Balance for a confirmed payment exactly once. `payment` is a verified PayHere notification:
// { orderId, paymentId, amount, currency, eventKey }. Returns the resulting status, 'duplicate' or null.
export const settleTopup = async ({ orderId, paymentId, amount, currency, eventKey }) =>
  withTransaction(async (client) => {
    const id = Number(orderId);
    const found = Number.isInteger(id) && id > 0
      ? await client.query('SELECT id FROM topups WHERE id = $1', [id])
      : { rows: [] };
    const topupId = found.rows[0]?.id ?? null;

    const seen = await client.query(
      'INSERT INTO payment_events (id, type, topup_id, note) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id',
      [eventKey, 'paid', topupId, topupId ? null : 'No matching top-up attempt']
    );
    if (seen.rows.length === 0) return 'duplicate';
    if (topupId === null) return null;

    const topup = (await client.query('SELECT * FROM topups WHERE id = $1 FOR UPDATE', [topupId])).rows[0];
    if (topup.status === 'succeeded' || topup.status === 'review') return topup.status;

    if (Math.round(Number(amount) * 100) !== Math.round(topup.amount * 100) || currency !== topup.currency) {
      await markReview(client, topupId, 'Paid amount or currency does not match the top-up request');
      return 'review';
    }

    const user = (await client.query('SELECT id, status FROM users WHERE id = $1 FOR UPDATE', [topup.user_id])).rows[0];
    if (!user || user.status !== 'active') {
      await markReview(client, topupId, 'Account is not active; payment received but not credited');
      return 'review';
    }

    await client.query('UPDATE users SET balance = balance + $2 WHERE id = $1', [topup.user_id, topup.amount]);
    const txn = await client.query(
      `INSERT INTO transactions (user_id, type, title, amount, topup_id)
       VALUES ($1, 'credit', 'Card Recharge (PayHere)', $2, $3) RETURNING id`,
      [topup.user_id, topup.amount, topupId]
    );
    await client.query(
      `UPDATE topups SET status = 'succeeded', transaction_id = $2, payment_id = $3,
              failure_reason = NULL, updated_at = now()
       WHERE id = $1`,
      [topupId, txn.rows[0].id, paymentId]
    );
    return 'succeeded';
  });

// Failure/cancel notifications never override a credited or review-flagged attempt.
export const markTopupStatus = async (topupId, status, reason = null) =>
  query(
    `UPDATE topups SET status = $2, failure_reason = COALESCE($3, failure_reason), updated_at = now()
     WHERE id = $1 AND status NOT IN ('succeeded', 'review')`,
    [topupId, status, reason]
  );

// Persists lazily-expired pending attempts so listings show them as expired.
export const expirePending = (userId = null) =>
  query(
    `UPDATE topups SET status = 'expired', updated_at = now()
     WHERE status = 'pending' AND expires_at < now() AND ($1::int IS NULL OR user_id = $1)`,
    [userId]
  );

export const cancelTopup = async (topup) => {
  if (topup.status === 'succeeded') throw new HttpError(409, 'This top-up has already been paid.');
  if (topup.status !== 'pending') return;
  // PayHere has no session to close; a payment that still completes is credited by its notification.
  await markTopupStatus(topup.id, 'cancelled');
};

// Asks PayHere whether an unconfirmed attempt was actually paid (heals a missed notification and makes
// local development work without a public notify URL). Uses the same dedupe key as the notification.
export const reconcileTopup = async (topup) => {
  if (!hasRetrievalApi() || !['pending', 'expired'].includes(topup.status)) return;
  try {
    const paid = await findPaidPayment(topup.id);
    if (paid) {
      await settleTopup({
        orderId: String(topup.id),
        paymentId: paid.paymentId,
        amount: paid.amount,
        currency: paid.currency,
        eventKey: `payhere:${paid.paymentId}:2`,
      });
    }
  } catch (err) {
    console.error('PayHere reconcile failed:', err.message);
  }
};
