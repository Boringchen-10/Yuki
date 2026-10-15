# Android Player Theme

Local preview v0.16.1. Public Android release remains v0.5.2.

## Cause And Fix

The appearance bridge previously changed only MainActivity system bars. PlayerPage, PlayerSettingsMenu and seek controls used fixed green/dark colors, independent of the selected appearance.

- React resolves both light/dark palettes through the actual CSS and browser canvas, including style tint, accent brightness and AMOLED. It does not duplicate HSL/color formulas in Kotlin. Resolved opaque colors cross a validated structured Rust command; sends are ordered.
- PlayerAppearance stores the two palettes and mode in app-private native preferences. System mode chooses the current native configuration even when the main WebView is backgrounded. Explicit light/dark overrides system configuration. PlayerActivity handles `uiMode` configuration changes itself, avoiding Activity/decoder recreation for a system-theme switch; the native test checks the installed manifest flag.
- Panels, comments, source choices, episode picker, popups, dialogs, selected rows and seek/spinner accents reuse the palette. White video-overlay controls and black video backing remain legible; no media/shader colors are altered.
- Live appearance changes redraw/rebind UI and close stale popups without recreating the Activity, libmpv engine or session. No database migration, media change or new dependency.

## Verification

- TypeScript and all 130 frontend tests pass. Six real React/CSS palette checks pass, covering light/dark/system, custom accent, AMOLED and system transitions; six widths are checked.
- Native PlayerAppearanceTest: 3 device tests pass for explicit modes, opposite system configurations, persistence, existing-page updates, menu surface/text/selection colors. Rust player subset: 7 pass; complete Rust suite: 414 passed / 19 existing ignored, including invalid palette/mode rejection.
- Real synthetic 40-second video in guarded organizeqa: switching actual settings from light to dark, then custom pink accent and AMOLED, preserves the engine instance, session and paused state through landscape rotation. Screenshots inspected; no user data seeded or copied. Evidence: `D:/DevTools/Android/Build/qa/player-theme-20261015/device-1792049579354/result.json`.
- Mixed browsing history and Download Center browser regressions remain passing (7 and 14 groups). Android optimized Rust, QA, daily debug and signed Release builds succeed. APK identity/signature/16KiB ZIP checks and 452-source receipt pass, with no bundled user database or media.
- Preview: `D:/DevTools/Android/Build/previews/player-theme-20261015/Genzo_0.16.1_player-theme_arm64-v8a.apk`; SHA-256 `dd348fa2b842029577fd64f9de63fb3aede95a23255c3500ef5f2cc5cd123918`.
- Both regular and daily packages were upgraded in place. Fresh before/after hashes preserve 36 works, 17 sources, 30 playback records, 7 books, 16 rules, personal fields, reading positions, shelf state and playback preferences. No user database or credentials were copied, and no user media was played by the verification.
- Read-only verification in the installed minified daily package confirms native cached mode, background and accent equal the actual current settings/CSS (dark mode in this sample), not only the unminified QA build.

## Source Ownership

`PLAYER_THEME_SOURCE_HANDOFF.patch` records only this fix's increments in the previously dirty AndroidApp, Android API and GenzoPlugin. It is already applied, on top of v0.16.0's source handoff. Do not apply it twice or commit unrelated OpenDesign WIP wholesale. Other clean/new theme modules are committed normally.
