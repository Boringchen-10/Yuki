CREATE TABLE rule_video_downloads (
    id TEXT PRIMARY KEY NOT NULL,
    recipe TEXT NOT NULL,
    title TEXT NOT NULL,
    episode_title TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued','downloading','paused','interrupted','failed','handed_off')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rule_video_downloads_state ON rule_video_downloads(state, created_at);
