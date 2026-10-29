PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login_name TEXT UNIQUE,
  phone TEXT UNIQUE,
  country TEXT CHECK (country IS NULL OR country IN ('SN','ML','CI','BJ')),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','locked')),
  invite_code TEXT UNIQUE,
  referred_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((role = 'admin' AND login_name IS NOT NULL) OR (role = 'user' AND phone IS NOT NULL AND country IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  country TEXT NOT NULL CHECK (country IN ('SN','ML','CI','BJ')),
  provider TEXT NOT NULL,
  amount_xof INTEGER NOT NULL CHECK (amount_xof > 0),
  external_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_id TEXT REFERENCES users(id),
  admin_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (country, provider, external_reference)
);
CREATE INDEX IF NOT EXISTS deposits_user_idx ON deposit_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deposits_status_idx ON deposit_requests(status, created_at);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  country TEXT NOT NULL CHECK (country IN ('SN','ML','CI','BJ')),
  provider TEXT NOT NULL,
  amount_xof INTEGER NOT NULL CHECK (amount_xof > 0),
  recipient_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected')),
  payout_reference TEXT,
  admin_id TEXT REFERENCES users(id),
  admin_note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS withdrawals_user_idx ON withdrawal_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawal_requests(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_payout_reference_unique
  ON withdrawal_requests(payout_reference)
  WHERE payout_reference IS NOT NULL AND payout_reference <> '';

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit','withdrawal','adjustment')),
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount_xof INTEGER NOT NULL CHECK (amount_xof > 0),
  related_type TEXT NOT NULL,
  related_id TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (related_type, related_id)
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger_entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_xof INTEGER,
  max_xof INTEGER,
  duration_days INTEGER,
  fees_description TEXT,
  withdrawal_terms TEXT,
  risk_disclosure TEXT,
  return_method TEXT,
  legal_approval_reference TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at DESC);
