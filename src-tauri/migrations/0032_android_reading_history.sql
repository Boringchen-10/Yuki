-- History visibility is independent of resume locations and bookmarks.
CREATE TABLE android_reading_history (
    kind TEXT NOT NULL CHECK(kind IN ('comic', 'novel')),
    book_id TEXT NOT NULL,
    group_id TEXT NOT NULL DEFAULT '',
    entry_id TEXT NOT NULL,
    entry_title TEXT NOT NULL DEFAULT '',
    page_count INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0, 1)),
    PRIMARY KEY(kind, book_id, group_id, entry_id),
    FOREIGN KEY(kind, book_id, group_id, entry_id)
        REFERENCES android_reading_progress(kind, book_id, group_id, entry_id) ON DELETE CASCADE
);
