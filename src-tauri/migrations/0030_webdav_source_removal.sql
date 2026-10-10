-- Keep indexed media identities and personal history when a connection is removed.
ALTER TABLE remote_sources ADD COLUMN removed_at TEXT;
