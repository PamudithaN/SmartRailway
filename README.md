# 🚆 SmartRail Sri Lanka

Smart-card (RFID) train ticketing for Sri Lanka Railways. Passengers keep a Balance on their Card, top it up
online through PayHere, and tap the Card at the start and end of a trip; the Route's fixed Fare is debited when
they tap out. Admins manage users, Routes and Fares, Cards and RFID readers. The web app is an installable PWA
that also works on phones.

## Features

- **Passenger dashboard:** Balance, recent Transactions, Trips and Top-ups.
- **Online Top-ups:** PayHere hosted checkout (LKR). The Balance is credited only after PayHere confirms the payment, exactly once.
- **Trip taps:** tap in to start a trip, tap out to pay the Route's fixed Fare. Works from real ESP32 RFID readers or the Admin simulator.
- **Routes & Live tracking board:** read-only Routes and Fares for Passengers, live train positions from a GPS feed.
- **Admin dashboard:** user management, Routes & Pricing (with audit trail), RFID emulation, Payments, Readers & Cards.
- **Secure auth:** bcrypt passwords, JWT sessions that can be revoked immediately, login throttling.
- **PWA and mobile:** installable on Android, iPhone and desktop, works offline with last-known data, layouts down to 320px wide.

## Tech stack

| Part | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion, lucide-react, vite-plugin-pwa |
| Backend | Node.js (ESM), Express |
| Database | PostgreSQL |
| Payments | PayHere (sandbox by default) |
| Hardware | ESP32 + RC522 RFID reader (optional) |

## Project structure

```
SmartRail/
├── backend/                 Express API (port 5000)
│   ├── server.js            app setup and core routes
│   ├── routes/              users, routes, trips, trains, top-ups, cards, devices, reader taps
│   ├── lib/                 tap logic, PayHere, top-up settlement, validation
│   ├── middleware/auth.js   JWT check and roles
│   ├── db/                  schema.sql, seed data, startup migrations
│   └── scripts/             create-admin, import old data.json
├── frontend/                React PWA (dev server 5173, preview 4173)
│   ├── src/pages/           Login, Dashboard, AdminDashboard, Routes
│   ├── src/components/      dialogs, admin panels, install/update/offline UI
│   ├── src/lib/, src/hooks/ offline cache and online status
│   └── vite.config.js       PWA manifest and service worker settings
├── _specs/, _plans/         feature specs and implementation plans
├── PAYHERE_SETUP.md         PayHere sandbox + ngrok
├── MOBILE_LOCAL_SETUP.md    open the app on a phone over local Wi-Fi
└── ARDUINO_SETUP.md         connect an ESP32 RFID reader
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+ (`node -v`; required by Vite 8)
- [PostgreSQL](https://www.postgresql.org/download/) 14 or newer, running locally
- Git

## Getting started

Commands below work in Windows PowerShell as well as macOS/Linux terminals unless noted.

### 1. Get the code

```bash
git clone https://github.com/PamudithaN/SmartRailway.git
cd SmartRail
```

### 2. Create the database

```bash
psql -U postgres -c "CREATE DATABASE smartrail;"
```

(Or create a database named `smartrail` in pgAdmin.) Tables and demo data are created automatically the first
time the backend starts.

### 3. Configure the backend

Copy the example settings file:

```powershell
# Windows PowerShell
Copy-Item backend\.env.example backend\.env
```

```bash
# macOS / Linux
cp backend/.env.example backend/.env
```

Open `backend/.env` and set at least:

```
DATABASE_URL=postgresql://postgres:<your-password>@localhost:5432/smartrail
JWT_SECRET=<a long random string>
```

Generate a `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

PayHere settings are optional for a first run; without them, Top-ups show "Online payments are unavailable".
See [PAYHERE_SETUP.md](PAYHERE_SETUP.md).

### 4. Install and start the backend

```bash
cd backend
npm install
npm start
```

The API runs on `http://localhost:5000`. Leave this terminal open.

### 5. Install and start the frontend

In a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 6. Sign in

| Role | Username | Password |
|---|---|---|
| Passenger | `nirmal` | `user123` |
| Admin | `admin` | `admin_rail_2024` |

New Passengers can register from the login page. To create another Admin (or reset an Admin's password):

```bash
cd backend
npm run admin:create -- <username> <password>
```

## Commands

### Backend (`backend/`)

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm start` | Start the API on port 5000 (`PORT` in `.env` to change) |
| `npm run dev` | Start with auto-restart on file changes (nodemon) |
| `npm run admin:create -- <username> <password>` | Create an Admin, or reset an existing account to an active Admin with that password |
| `npm run db:import` | Copy an old `backend/data.json` into an **empty** database (run before the first start) |

### Frontend (`frontend/`)

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Development server on `http://localhost:5173` (no service worker) |
| `npm run build` | Production build to `frontend/dist`, including the service worker |
| `npm run preview` | Serve the production build on `http://localhost:4173` (use this to test install/offline) |
| `npx vite preview --host` | Same, but reachable from other devices on your network |
| `npm run generate-pwa-assets` | Regenerate the app icons and favicon from `public/logo.svg` |

The frontend calls the API at `http://localhost:5000` by default. To use another address, create
`frontend/.env` with `VITE_API_URL=http://<host>:5000` and rebuild.

## Using it on a phone

- **Same Wi-Fi as the laptop:** follow [MOBILE_LOCAL_SETUP.md](MOBILE_LOCAL_SETUP.md). Short version:

  ```powershell
  # 1. backend\.env: FRONTEND_URL=http://<laptop-ip>:4173   (find the IP with: ipconfig)
  # 2. frontend\.env: VITE_API_URL=http://<laptop-ip>:5000
  # 3. allow the ports (PowerShell as Administrator, once):
  New-NetFirewallRule -DisplayName "SmartRail" -Direction Inbound -Protocol TCP -LocalPort 5000,4173 -Action Allow -Profile Private
  # 4. run
  cd backend;  npm start
  cd frontend; npm run build; npx vite preview --host
  # 5. on the phone open http://<laptop-ip>:4173
  ```

  Over plain `http://` the app works, but installing, offline mode and PayHere top-ups need HTTPS.
- **Install the app:** on HTTPS (or `localhost`), use the browser's **Install app** option, the in-app
  **Install** button, or on iPhone **Share → Add to Home Screen**.

## Payments (PayHere)

Top-ups use the PayHere sandbox unless `PAYHERE_SANDBOX=false`. PayHere must reach the backend to confirm
payments, so local development uses an ngrok tunnel:

```bash
ngrok http 5000
```

Set `PAYHERE_NOTIFY_URL=https://<your-tunnel>/api/payhere/notify` in `backend/.env` and restart the backend.
Full steps, test cards and troubleshooting: [PAYHERE_SETUP.md](PAYHERE_SETUP.md).

## RFID hardware

Readers (ESP32 + RC522) send taps to `POST /api/device/tap` with a per-device key. Register Cards and readers in
the Admin dashboard under **Readers & Cards**. Wiring, firmware and provisioning:
[ARDUINO_SETUP.md](ARDUINO_SETUP.md).

## Resetting the data

Drop and recreate the database, then start the backend; it re-creates the tables and demo data:

```bash
psql -U postgres -c "DROP DATABASE smartrail;"
psql -U postgres -c "CREATE DATABASE smartrail;"
cd backend
npm start
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Backend exits with a database error | PostgreSQL isn't running or `DATABASE_URL` is wrong. |
| Backend exits saying `JWT_SECRET` is missing | Set `JWT_SECRET` in `backend/.env`. |
| Login page shows "Server connection failed" | The backend isn't running, or `VITE_API_URL` points to the wrong address (rebuild after changing it). |
| "Too many attempts" on login | 5 wrong passwords block that username for 15 minutes. Wait, or restart the backend. |
| Admin password doesn't work | Reset it: `npm run admin:create -- admin <new-password>` in `backend/`. |
| Top-up says "Online payments are unavailable" | PayHere merchant settings are missing in `backend/.env`. |
| Top-up stays pending | `PAYHERE_NOTIFY_URL` is missing or the ngrok tunnel is closed. |
| PayHere shows "Unauthorized payment request" | The page's domain isn't registered in your PayHere account (for example a `192.168.x.x` address). |
| The installed app shows an old version | Tap **Refresh** on the "new version" message, or close and reopen the app. |

## Documentation

- [smartrail-ticketing.md](smartrail-ticketing.md): project status and roadmap
- [PAYHERE_SETUP.md](PAYHERE_SETUP.md): PayHere sandbox and ngrok
- [MOBILE_LOCAL_SETUP.md](MOBILE_LOCAL_SETUP.md): phone on the same Wi-Fi
- [ARDUINO_SETUP.md](ARDUINO_SETUP.md): ESP32 RFID reader
- [CLAUDE.md](CLAUDE.md): architecture, API endpoints and data shapes for developers

---
*Created as part of the SmartRail Innovators Research Project.*
