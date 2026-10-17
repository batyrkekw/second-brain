ALTER TABLE user_settings ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE webhook_events ADD COLUMN lease_until INTEGER;
ALTER TABLE webhook_events ADD COLUMN lease_token TEXT;
