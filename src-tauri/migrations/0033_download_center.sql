CREATE TABLE download_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    identity TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('comic', 'novel', 'file')),
    title TEXT NOT NULL,
    item_title TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued', 'downloading', 'paused', 'interrupted', 'failed', 'completed')),
    bytes_downloaded INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER,
    completed_units INTEGER NOT NULL DEFAULT 0,
    total_units INTEGER,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    path_word TEXT,
    group_id TEXT,
    entry_id TEXT,
    media_file_id TEXT,
    work_id TEXT,
    generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_download_jobs_state ON download_jobs(state, created_at);
