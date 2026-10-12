# 🚆 Project Status: SmartRail Ticketing System

## 📜 Overview
SmartRail is a premium, PWA-certified smart card ticketing system for Sri Lanka Railways. This system integrates a persistent Node.js backend with a "Gallery Minimalist" React frontend, supporting real-time train tracking across 9 major railway lines and physical-hardware emulation.

## 🏗️ Technical Architecture
- **Tech Stack:** React (Vite) + Node.js (ESM) + Tailwind CSS + Framer Motion.
- **Persistence:** PostgreSQL (`DATABASE_URL` in `backend/.env`); balance changes and ledger entries are written atomically.
- **Auth:** JWT (`JWT_SECRET` in `backend/.env`), bcrypt passwords, `Authorization: Bearer` on all API calls.
- **PWA:** Installable on Android, iOS and desktop (generated manifest, maskable/Apple icons, service worker). The app shell works offline, Passengers see their last-known Balance and Transactions offline, and installed copies are prompted to update.
- **Hardware Bridge:** Dedicated RFID Tap API ready for Arduino/NodeMCU integration.

## ✅ Current System Capabilities
- [x] **Persistence:** Real-time saving of balances, users, and transaction logs.
- [x] **Full 9-Line Network:** Includes all official SLR lines (Main, Coast, Northern, Kelani Valley, etc.) with precise KM markers.
- [x] **Live Tracking Board:** Shows train positions posted by a GPS feed, with a "no signal" state when updates stop.
- [x] **Routes & Pricing:** Admins manage Routes, Stations and one fixed trip Fare per Route with an audit trail; Passengers see a read-only view.
- [x] **Trip taps:** A tap at the start and end of a trip; the Route's fixed Fare is debited once on completion.
- [x] **Admin Tooling:** Route and fixed-fare management, trip-based RFID simulation, and full user management (create, edit, deactivate, reset password, delete).
- [x] **Secure Auth:** bcrypt-hashed passwords, JWT sessions with expiry and revocation, role-enforced API, login throttling.
- [x] **Transaction Ledger:** Automated receipt generation for every top-up and tap.
- [x] **UX Excellence:** 3D animated login, responsive layouts down to 320px (Admin drawer navigation on phones), reduced-motion support, and strict "Maestro" design (No-Purple).

## 📊 Database Schema (SLR Official KM)
| Line Name | Origin-Destination (KM) | Distance |
| :--- | :--- | :--- |
| **Main Line** | Colombo Fort (0) - Badulla (290) | 290 km |
| **Coast Line** | Colombo Fort (0) - Beliatta (187) | 187 km |
| **Northern Line** | Polgahawela (72) - KKS (411) | 339 km |
| **Kelani Valley** | Maradana (2) - Avissawella (59) | 57 km |
| **Puttalam Line** | Ragama (13) - Puttalam (133) | 120 km |

## 🛠️ Access Credentials
- **Passenger:** `nirmal` / `user123`
- **Administrator:** `admin` / `admin_rail_2024`

## 📅 Maintenance & Roadmap
- [x] **Phase 1-4:** Foundation, Design System, Auth, and Dashboards (DONE).
- [x] **Phase 5:** Database Persistence & PWA Conversion (DONE; installability, offline viewing and mobile layouts completed in `_specs/2610120256_pwa-and-mobile-support.md`).
- [ ] **Phase 6:** Physical Arduino/ESP32 Hardware Connection. Software path DONE: PayHere top-ups, device-key authenticated `POST /api/device/tap`, card/device registry in the Admin dashboard. Remaining: reader firmware and provisioning.
- [ ] **Phase 7:** Passenger Mobile App (Native Shell).

---
*Updated based on Sri Lanka Railways official network maps and 2026 technical requirements.*
