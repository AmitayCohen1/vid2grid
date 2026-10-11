-- Product analytics for /admin (app/api/track writes, app/admin reads).
-- Apply with: node --env-file=.env.local scripts/db-migrate.mjs
CREATE TABLE IF NOT EXISTS events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  visitor text NOT NULL,
  session text NOT NULL,
  path text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  country text,
  device text,
  browser text,
  referrer text
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts DESC);
CREATE INDEX IF NOT EXISTS events_name_ts_idx ON events (name, ts DESC);
CREATE INDEX IF NOT EXISTS events_visitor_idx ON events (visitor);
