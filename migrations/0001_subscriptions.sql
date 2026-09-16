CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','active','unsubscribed','bounced')),
  confirmation_hash TEXT,
  confirmation_expires INTEGER,
  confirmation_requested INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX subscribers_status ON subscribers(status);
CREATE UNIQUE INDEX subscribers_confirmation ON subscribers(confirmation_hash);
CREATE TABLE campaigns (
  month TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE deliveries (
  month TEXT NOT NULL REFERENCES campaigns(month),
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','cancelled')),
  attempted_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  PRIMARY KEY(month, subscriber_id)
);
CREATE INDEX deliveries_status ON deliveries(month, status);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
