# Android Download Center

Scope: local preview v0.16.0, based on the active OpenDesign checkout. Public Android release remains v0.5.2.

## Model

- Migrations 0032/0033/0034 add history visibility, durable book/file jobs and stable rule-video recipes. Historical migrations remain unchanged.
- Comic/novel jobs reuse verified generated reading-cache manifests. WebDAV jobs reuse the existing bounded transfer and Range validation. Source media, positions and bookmarks are never removed by download cleanup.
- Rule-video jobs persist plugin/source/episode identities, not resolved media URLs. A single resolver hands requests to Android Media3 1.9.4 DownloadManager/DownloadService. Retry refreshes the rule address independently of interactive playback resolution.
- Media3 only downloads; libmpv remains the player. HTTP progressive and unencrypted/AES-128 HLS VOD are supported. Live, DRM and unsupported formats fail explicitly. One video variant up to 1080p (lowest available when all exceed 1080p) and required audio are selected.
- Native credentials, signed URLs and resource mapping keys use CredentialStore AES-GCM. Ordinary indexes and public DTOs contain opaque resources / safe errors only.
- Offline playback uses a random-token loopback cache-only bridge with Range responses. Missing cache is an error, never an upstream fallback. Android private WebDAV cache files are canonicalized under remote-cache before opening.
- Startup preserves paused jobs and marks unfinished resolution / transfer interrupted. The user explicitly continues after interruption. No startup scan of user media or automatic full-book downloads is introduced.

## UI

- My page opens the real Download Center. Active/completed tabs, content filters, actual progress, independent pending actions, retry and removal confirmation share existing theme tokens.
- Comic/novel multi-select queues chapters or volumes. Rule selections support single or selected episodes; indexed WebDAV/rule episode options expose download.
- Actual reading locations populate Browsing History. Hiding history does not erase resume/bookmarks/cache; real reading restores visibility.
- Player options expand in the same menu. Landscape speed, super-resolution and subtitle shortcuts are not duplicated in more.

## Validation

- TypeScript and 129 frontend tests pass. Windows Rust full suite: 413 passed, 19 existing ignored; final video facade subset: 6 passed.
- Real React download-center checks cover 14 cases / 6 widths. Entry and reading-row checks cover 5 and 3 cases; full AndroidApp mixed history covers 7 groups / 6 widths. Browser mocks are not native download evidence.
- PLK110 Android 16, isolated `com.genzo.android.organizeqa`: offline download instrumentation 8 passed; episode-comment instrumentation 6 passed, including supplied image rendering and failed-image retry.
- Real synthetic 4,120,162-byte MP4, generated 40-second HLS VOD and authenticated WebDAV all complete and play through libmpv with their upstream media server stopped. Cache seeking, stable media IDs, persisted progress, paused-task restart, completed-task restart, fresh-address retry and WebDAV Range resume pass. No HLS skip was used in the final run.
- Android optimized Rust, QA APK, daily debug APK and signed arm64 release APK build successfully. Preview APK: `D:/DevTools/Android/Build/previews/downloads-history-20261015/Genzo_0.16.0_downloads-history_arm64-v8a.apk`, SHA-256 `43a2207861eeaea879cfb8705b6a8484ff8808546fbd3d7b5cb73a47aa9db6c9`.
- Evidence: `D:/DevTools/Android/Build/qa/downloads-history-20261014/`, especially `native-downloads/1792045347054/result.json`. The first locked-screen playback attempt failed and is not counted as passing; its own synthetic task has subsequently been removed using guarded package/task checks. User package was not seeded or copied.
- Final player-menu short regression: 17 checks pass in `D:/DevTools/Android/Build/qa/player-page-1792046968705/result.json`, including inline bounds, back-collapse, actual speed/shaders, landscape shortcuts/deduplication, source identities, episode changes and fullscreen return. Menu screenshots were inspected. Long subtitle/audio lists remain outside this short device sample.
- Both regular and daily readerqa packages were upgraded in place to v0.16.0. Installed APK hashes match the verified artifacts. A fresh before/after read-only snapshot preserves 36 works, 17 sources, 30 playback records, 7 books, 16 rules, personal fields, resume positions, shelf state and playback preferences; no user database or credentials were copied.
- Residual limitation: if the process dies between native commit and SQLite handoff confirmation, a pending task may need to re-prepare and lose partial video download progress. Completed caches and private credentials remain isolated; no network fallback is introduced.

## Source Ownership

`DOWNLOAD_CENTER_SOURCE_HANDOFF.patch` records only this task's increments in AndroidApp, mobile.css, RuleBrowser, EpisodeSources, the existing untracked BangumiCommentFeed and GenzoPlugin. It is already applied in the active checkout; do not apply it twice. Their unrelated OpenDesign WIP is intentionally not committed wholesale. Clean modules and new download/history/comment implementations are committed normally. Main checkout desktop WIP remains untouched.

References: [Android Media3 downloads](https://developer.android.com/media/media3/exoplayer/downloading-media), [Media3 licenses](https://github.com/androidx/media/blob/release/LICENSE).
