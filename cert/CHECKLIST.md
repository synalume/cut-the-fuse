# Cut the Fuse — Playables certification checklist

YouTube Playables / MC Play upload. Build: `./cert/make-bundle.sh` → `cert/out/cut-the-fuse-playables.zip`.

## Status (2026-08-30)

- **MediaCube dashboard: Premoderation** — submitted 30.08.2026 10:16, v1.0.0, 3+, no ads described.
- All pre-build + bundle-gate + QA items below are complete and verified (smoke + Playwright suites).
- Email follow-up sent to MediaCube (Nadia Kutuzova, BD) on 2026-08-30 announcing the submission.

## Pre-build

- [x] Placeholder art in `assets/` (lvl1 set) + baked audio in `assets/audio/` (ignite, snip, dud, blast, win_star, wick_crackle)
- [x] `src/data/levels.json` validates with zero warnings (`node tools/level-gen/gen-levels.mjs`)
- [x] 120-level ladder playable end-to-end; no black-hole levels (analytics: attempts per level)
- [x] Marketing thumbnails generated (`tools/gen-marketing/` → `cert/thumbnails/`, `playgama/covers/`, `locked-branding/`)

## Bundle gate (script enforces)

- [x] YouTube game_api script present, no Playgama Bridge, no Poki SDK
- [x] `__CUT_THE_FUSE_PLAYABLES__ = true` flag injected
- [x] No `tools/`, `cert/`, `locked-branding/` in zip
- [x] All filenames `[A-Za-z0-9._-]` (script checks)
- [x] Zip `< 30 MiB` initial (actual ~11.3 MiB with placeholder assets)

## QA walk (in the Playables test environment)

- [x] Esc closes every modal (tutorial, win, lose, DDA, skins, end screen)
- [x] "No more content" screen after level 120, with replay
- [x] Progress saves between sessions (stars, unlocked level)
- [x] Pause on tab hide; resume continues (onPause/onResume — Page Visibility API not used)
- [x] Zero external network calls (no analytics, no CDN) — `Analytics` is disabled by the flag
- [x] Audio files play from the zip (no live-only synth bed)
- [x] Color pillar: wire legend renders near the bomb; a forbidden-color cut is denied once with a red "WRONG WIRE!" warning, then detonates on the second offense
- [x] Mechanics sweep: gold stars bank a snip (chime + "SNIP +1"), water drops douse their fuse, twin bombs both show reaction words when threatened

## Ref (Mediacube / review bookmarks)

- Big Fluff cert checklist: [`../big-fluff/cert/CHECKLIST.md`](../big-fluff/cert/CHECKLIST.md)
- Mediacube and Playables policies re-checked before submit

## Portal SDK compliance (wired)

Verified by `tools/smoke/verify-portal.mjs` (mock Playgama Bridge v2 + mock Playables SDK):

- **Playgama Bridge v2** — `bridge.initialize()` awaited before any SDK call;
  `bridge.platform.sendMessage("game_ready")` on the first playable frame;
  `PAUSE_STATE_CHANGED` + `AUDIO_STATE_CHANGED` subscribed (audio muted on
  host mute via master-gain ducking); `bridge.platform.language` read for
  localization; saves go through `bridge.storage.get/set` (never localStorage,
  re-detected after Bridge init); interstitial shown at level clear via
  `bridge.advertisement.showInterstitial("level_complete")`.
- **YouTube Playables** — `ytgame.firstFrameReady()` precedes `ytgame.gameReady()`;
  `ytgame.onPause/onResume` replace the Page Visibility API; saves go through
  `ytgame.loadData/saveData`.

> Bundle-size: cert zip is ~11 MiB (dead root-level UI PNGs removed — the game
> only references `assets/ui/*`). Well under the Playables 30 MiB initial cap.
> Every individual file < 512 KiB (MediaCube `individual_file_size_recommended`).
