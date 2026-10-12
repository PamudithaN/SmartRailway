import crypto from 'crypto';

const md5Upper = (text) => crypto.createHash('md5').update(text).digest('hex').toUpperCase();

export const merchantId = () => process.env.PAYHERE_MERCHANT_ID || '';
const merchantSecret = () => process.env.PAYHERE_MERCHANT_SECRET || '';

export const isConfigured = () => merchantId() !== '' && merchantSecret() !== '';

// Sandbox unless PAYHERE_SANDBOX is explicitly "false", so a live deployment is always a deliberate choice.
export const isSandbox = () => process.env.PAYHERE_SANDBOX !== 'false';

export const payhereMode = () => {
  if (!isConfigured()) return 'unconfigured';
  return isSandbox() ? 'sandbox' : 'live';
};

export const checkoutUrl = () =>
  isSandbox() ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout';

export const formatAmount = (amount) => Number(amount).toFixed(2);

// Hash sent with the checkout form so PayHere can reject tampered amounts.
export const checkoutHash = ({ orderId, amount, currency }) =>
  md5Upper(`${merchantId()}${orderId}${formatAmount(amount)}${currency}${md5Upper(merchantSecret())}`);

// Verifies the md5sig on a server-to-server notification.
export const verifyNotification = (body) => {
  const { merchant_id, order_id, payhere_amount, payhere_currency, status_code, md5sig } = body || {};
  if (![merchant_id, order_id, payhere_amount, payhere_currency, status_code, md5sig].every((v) => typeof v === 'string')) {
    return false;
  }
  if (merchant_id !== merchantId()) return false;
  const expected = md5Upper(
    `${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${md5Upper(merchantSecret())}`
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(md5sig.toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// --- Payment Retrieval API (OAuth app credentials, separate from the merchant secret) ---
export const hasRetrievalApi = () => (process.env.PAYHERE_APP_ID || '') !== '' && (process.env.PAYHERE_APP_SECRET || '') !== '';

const apiBase = () => (isSandbox() ? 'https://sandbox.payhere.lk' : 'https://www.payhere.lk');

let tokenCache = { value: null, expiresAt: 0 };

const accessToken = async () => {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 30000) return tokenCache.value;
  const basic = Buffer.from(`${process.env.PAYHERE_APP_ID}:${process.env.PAYHERE_APP_SECRET}`).toString('base64');
  const res = await fetch(`${apiBase()}/merchant/v1/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`PayHere token request failed (${res.status}) ${json.error_description || json.error || ''}`.trim());
  }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 300) * 1000 };
  return tokenCache.value;
};

// Looks up the payments PayHere holds for one of our order ids. Returns the paid (RECEIVED) payment or null.
export const findPaidPayment = async (orderId) => {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/merchant/v1/payment/search?order_id=${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) tokenCache = { value: null, expiresAt: 0 };
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`PayHere payment search failed (${res.status})`);
  const list = Array.isArray(json.data) ? json.data : [];
  const paid = list.find((p) => String(p.order_id) === String(orderId) && String(p.status).toUpperCase() === 'RECEIVED');
  return paid
    ? { paymentId: String(paid.payment_id), amount: paid.amount, currency: String(paid.currency || '').toUpperCase() }
    : null;
};
