import { verifyNotification } from '../lib/payhere.js';
import { settleTopup, markTopupStatus } from '../lib/topups.js';
import { query } from '../db/index.js';

// PayHere server-to-server notification (form-encoded). Authenticated by the md5sig, not by a JWT.
export const payhereNotify = async (req, res) => {
  const body = req.body || {};
  if (!verifyNotification(body)) {
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  try {
    const { order_id: orderId, payment_id: paymentId, payhere_amount: amount, payhere_currency: currency } = body;
    const status = Number(body.status_code);
    const topupId = Number(orderId);

    if (status === 2) {
      await settleTopup({
        orderId,
        paymentId: paymentId || null,
        amount,
        currency,
        eventKey: `payhere:${paymentId || orderId}:${status}`,
      });
    } else if (Number.isInteger(topupId) && topupId > 0) {
      if (status === -1) await markTopupStatus(topupId, 'cancelled');
      else if (status === -2) await markTopupStatus(topupId, 'failed', body.status_message || 'Payment failed');
      else if (status === -3) {
        // Chargebacks are handled manually; record it for the Admin.
        await query(
          "UPDATE topups SET failure_reason = 'Chargeback reported by PayHere', updated_at = now() WHERE id = $1",
          [topupId]
        );
      }
      // status 0 (pending) needs no change.
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('PayHere notification failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
