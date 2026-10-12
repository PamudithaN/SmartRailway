# PayHere sandbox and ngrok setup (local development)

SmartRail top-ups are paid through PayHere (LKR). PayHere confirms each payment by calling the backend
(`POST /api/payhere/notify`). PayHere cannot reach `localhost`, so during local development the backend
must be exposed through a tunnel such as ngrok. Without it, payments succeed on PayHere's side but the
top-up stays `pending` and the balance is not credited.

## 1. PayHere sandbox account

1. Register at https://sandbox.payhere.lk.
2. Open **Integrations** and add a domain/app: `localhost`. Note the **Merchant ID** and **Merchant Secret**.
3. Add them to `backend/.env` (this file is gitignored, never commit it):

   ```
   PAYHERE_MERCHANT_ID=<merchant id>
   PAYHERE_MERCHANT_SECRET=<merchant secret>
   PAYHERE_SANDBOX=true
   FRONTEND_URL=http://localhost:5173
   ```

`PAYHERE_SANDBOX` defaults to sandbox; live mode only applies when it is explicitly `false`.

## 2. Install ngrok (Windows)

1. Create a free account at https://dashboard.ngrok.com/signup.
2. Install the agent in PowerShell:

   ```
   winget install ngrok.ngrok
   ```

   or download the ZIP from https://ngrok.com/download and put `ngrok.exe` on your PATH.
3. Register your authtoken (from https://dashboard.ngrok.com/get-started/your-authtoken):

   ```
   ngrok config add-authtoken <your-token>
   ```
4. Check the version: `ngrok version`. Free accounts require **3.20.0 or newer**. If you see
   `ERR_NGROK_121 ... agent version is too old`, run `ngrok update` (or `winget upgrade ngrok.ngrok`).
   If the old version still runs, `where ngrok` lists the copies on your PATH; update the one listed first.

## 3. Run it

Start the backend (`cd backend && npm start`), then in a second terminal:

```
ngrok http 5000
```

Copy the `https://....ngrok-free.app` (or `.ngrok-free.dev`) address from the `Forwarding` line and set it
in `backend/.env`:

```
PAYHERE_NOTIFY_URL=https://<your-address>/api/payhere/notify
```

Restart the backend so it picks the value up. Keep the ngrok window open while testing.

> The address changes every time ngrok restarts on the free plan. Update `PAYHERE_NOTIFY_URL` and restart
> the backend when it does.

## 4. Verify the tunnel

Opening the notify URL in a browser returns `{"success":false,"message":"Not signed in"}`. That is expected:
a browser sends `GET`, and PayHere sends `POST`. A proper check is a `POST`:

```
curl.exe -X POST https://<your-address>/api/payhere/notify -d "order_id=1"
```

Expected reply: `{"success":false,"message":"Invalid signature"}`, which means the request reached the
PayHere handler.

## 5. Test a top-up

1. Run the frontend (`cd frontend && npm run dev`) and sign in as a passenger.
2. Click **Top up**, enter an amount (Rs. 500 to Rs. 50000, whole rupees), and click **Pay with PayHere**.
3. Pay with a sandbox test card from PayHere's sandbox documentation.
4. You are returned to the Dashboard. The ngrok window should show `POST /api/payhere/notify 200`, the
   Dashboard shows "Payment successful" with the new balance, and the Admin **Payments** tab shows the
   attempt as `succeeded`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Top-up stays `pending` after paying | `PAYHERE_NOTIFY_URL` missing/outdated, backend not restarted, or ngrok closed. Check the ngrok window for the notify request. |
| ngrok shows `POST /api/payhere/notify 400` | Signature mismatch: the merchant secret or merchant ID in `.env` differs from the portal. |
| Attempt shows `review` in Admin Payments | The paid amount or currency did not match the request, or the account was not active. Needs manual attention. |
| Return page goes to the wrong address | `FRONTEND_URL` does not match the Vite dev server address. |
| "Online payments are unavailable" | `PAYHERE_MERCHANT_ID` / `PAYHERE_MERCHANT_SECRET` not set. |

## Notes

- `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` (Payment Retrieval API) are optional. From a local machine PayHere
  rejects the lookup with `Access denied for the domain`, so rely on the notify URL instead.
- Payment notifications are verified with the `md5sig` hash and credited exactly once, so replays are safe.
- Never commit `backend/.env` or paste merchant secrets into issues or chat.
