CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  phone         TEXT,
  nic           TEXT,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated', 'deleted')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for databases created before authentication was reworked.
-- password_hash is nullable here; init.js fills it from the legacy plaintext column and then enforces NOT NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated', 'deleted'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nic TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Existing and seeded accounts have no contact details; uniqueness only applies where they are set.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_nic_key ON users (upper(nic)) WHERE nic IS NOT NULL;

CREATE TABLE IF NOT EXISTS routes (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  stations  TEXT NOT NULL,
  base_fare NUMERIC(10,2) NOT NULL,
  per_km    NUMERIC(10,2) NOT NULL,
  total_km  NUMERIC(8,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  title      TEXT NOT NULL,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_user_id_id_idx ON transactions (user_id, id DESC);

-- Routes & Pricing: one fixed trip fare per route. base_fare / per_km / total_km / stations are legacy.
ALTER TABLE routes ADD COLUMN IF NOT EXISTS fare NUMERIC(10,2) CHECK (fare >= 0);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE routes ALTER COLUMN stations DROP NOT NULL;
ALTER TABLE routes ALTER COLUMN base_fare DROP NOT NULL;
ALTER TABLE routes ALTER COLUMN per_km DROP NOT NULL;
ALTER TABLE routes ALTER COLUMN total_km DROP NOT NULL;

CREATE TABLE IF NOT EXISTS stations (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS stations_name_key ON stations (lower(name));

CREATE TABLE IF NOT EXISTS route_stations (
  route_id   INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  position   INTEGER NOT NULL,
  PRIMARY KEY (route_id, position),
  UNIQUE (route_id, station_id)
);

CREATE TABLE IF NOT EXISTS trips (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  route_id         INTEGER NOT NULL REFERENCES routes(id),
  start_station_id INTEGER NOT NULL REFERENCES stations(id),
  end_station_id   INTEGER REFERENCES stations(id),
  fare             NUMERIC(10,2) NOT NULL CHECK (fare >= 0),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  transaction_id   BIGINT REFERENCES transactions(id),
  cancelled_by     INTEGER REFERENCES users(id),
  cancel_reason    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_open_per_user ON trips (user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS trips_status_started_idx ON trips (status, started_at DESC);
CREATE INDEX IF NOT EXISTS trips_user_id_id_idx ON trips (user_id, id DESC);

CREATE TABLE IF NOT EXISTS route_audit (
  id         BIGSERIAL PRIMARY KEY,
  route_id   INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  admin_id   INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_audit_route_idx ON route_audit (route_id, id DESC);

CREATE TABLE IF NOT EXISTS train_positions (
  train_no    TEXT PRIMARY KEY,
  train_name  TEXT,
  route_id    INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  latitude    NUMERIC(9,6) NOT NULL,
  longitude   NUMERIC(9,6) NOT NULL,
  speed_kmh   NUMERIC(6,1),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Online top-ups (PayHere): one row per attempt; credited exactly once by settleTopup.
-- stripe_session_id / stripe_payment_intent_id / stripe_events are legacy from the dropped Stripe integration.
CREATE TABLE IF NOT EXISTS topups (
  id                       BIGSERIAL PRIMARY KEY,
  user_id                  INTEGER NOT NULL REFERENCES users(id),
  amount                   NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency                 TEXT NOT NULL DEFAULT 'lkr',
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'expired', 'review')),
  stripe_session_id        TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  failure_reason           TEXT,
  transaction_id           BIGINT REFERENCES transactions(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS topups_user_id_idx ON topups (user_id, id DESC);
CREATE INDEX IF NOT EXISTS topups_status_idx ON topups (status, id DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT,
  topup_id     BIGINT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS topup_id BIGINT REFERENCES topups(id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_topup_id_key ON transactions (topup_id) WHERE topup_id IS NOT NULL;

-- Physical RFID cards (UID -> Passenger) and the reader devices allowed to submit taps.
CREATE TABLE IF NOT EXISTS cards (
  id         SERIAL PRIMARY KEY,
  uid        TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cards_uid_key ON cards (upper(uid));

CREATE TABLE IF NOT EXISTS devices (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  route_id     INTEGER NOT NULL REFERENCES routes(id),
  station_id   INTEGER NOT NULL REFERENCES stations(id),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tap_events (
  id          BIGSERIAL PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id),
  event_id    TEXT,
  card_uid    TEXT,
  user_id     INTEGER,
  action      TEXT,
  outcome     TEXT NOT NULL,
  http_status INTEGER,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tap_events_device_event_key ON tap_events (device_id, event_id)
  WHERE device_id IS NOT NULL AND event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tap_events_id_idx ON tap_events (id DESC);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_source TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_source TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS device_id INTEGER REFERENCES devices(id);

-- Station masters verify the Passenger's end-of-trip QR code.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'station_master'));

-- Trip lifecycle: open -> ended (Passenger pressed End Trip, fare debited, QR issued) -> completed (QR scanned).
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check CHECK (status IN ('open', 'ended', 'completed', 'cancelled'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS scanned_by INTEGER REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS trips_qr_token_key ON trips (qr_token) WHERE qr_token IS NOT NULL;

ALTER TABLE topups ADD COLUMN IF NOT EXISTS payment_id TEXT;
CREATE TABLE IF NOT EXISTS payment_events (
  id           TEXT PRIMARY KEY,
  type         TEXT,
  topup_id     BIGINT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT
);
