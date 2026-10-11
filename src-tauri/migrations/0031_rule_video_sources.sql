CREATE TABLE rule_plugins (
    id TEXT PRIMARY KEY NOT NULL REFERENCES library_roots(id) ON DELETE RESTRICT,
    name_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    origin TEXT,
    removed_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE rule_work_sources (
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL REFERENCES rule_plugins(id) ON DELETE RESTRICT,
    source_key TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(work_id,plugin_id,source_key)
);
CREATE TABLE rule_episodes (
    media_file_id TEXT PRIMARY KEY NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL REFERENCES rule_plugins(id) ON DELETE RESTRICT,
    source_key TEXT NOT NULL,
    page_url TEXT NOT NULL,
    road_name TEXT NOT NULL,
    episode_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(plugin_id,page_url)
);
CREATE INDEX idx_rule_work_sources_plugin ON rule_work_sources(plugin_id);
CREATE INDEX idx_rule_episodes_plugin ON rule_episodes(plugin_id);
