# Cut the Fuse — Playables certification checklist

YouTube Playables / MC Play upload. Build: `./cert/make-bundle.sh` → `cert/out/cut-the-fuse-playables.zip`.

## Pre-build

- [ ] Placeholder art in `assets/` (lvl1 set) + baked audio in `assets/audio/` (or synth fallback flagged in build log)
- [ ] `src/data/levels.json` validates with zero warnings (`node tools/level-gen/gen-levels.mjs`)
- [ ] 120-level ladder playable end-to-end; no black-hole levels (analytics: attempts per level)
- [x] Marketing thumbnails generated (`tools/gen-marketing/` → `cert/thumbnails/`, `playgama/covers/`, `locked-branding/`)

## Bundle gate (script enforces)

- [ ] YouTube game_api script present, no Playgama Bridge, no Poki SDK
- [ ] `__CUT_THE_FUSE_PLAYABLES__ = true` flag injected
- [ ] No `tools/`, `cert/`, `locked-branding/` in zip
- [ ] All filenames `[A-Za-z0-9._-]` (script checks)
- [ ] Zip `< 30 MiB` initial (target `< 10 MiB` with placeholder assets)

## QA walk (in the Playables test environment)

- [ ] Esc closes every modal (tutorial, win, lose, DDA, skins, end screen)
- [ ] "No more content" screen after level 120, with replay
- [ ] Progress saves between sessions (stars, unlocked level)
- [ ] Pause on tab hide; resume continues
- [ ] Zero external network calls (no analytics, no CDN) — `Analytics` is disabled by the flag
- [ ] Audio files play from the zip (no live-only synth bed)
- [ ] Color pillar: wire legend renders near the bomb; a forbidden-color cut is denied once with a red "WRONG WIRE!" warning, then detonates on the second offense
- [ ] Mechanics sweep: gold stars bank a snip (chime + "SNIP +1"), water drops douse their fuse, twin bombs both show reaction words when threatened

## Ref (Mediacube / review bookmarks)

- Big Fluff cert checklist: [`../big-fluff/cert/CHECKLIST.md`](../big-fluff/cert/CHECKLIST.md)
- Mediacube and Playables policies re-checked before submit

## Portal SDK compliance (wired)

Verified by `tools/smoke/verify-portal.mjs` (mock Playgama Bridge v2 + mock Playables SDK):

- **Playgama Bridge v2** — `bridge.initialize()` awaited before any SDK call;
  `bridge.platform.sendMessage("game_ready")` on the first playable frame;
  `PAUSE_STATE_CHANGED` + `AUDIO_STATE_CHANGED` subscribed (audio muted on
  host mute); `bridge.platform.language` read for localization; saves go
  through `bridge.storage.get/set` (never localStorage); interstitial shown at
  level clear via `bridge.advertisement.showInterstitial("level_complete")`.
- **YouTube Playables** — `ytgame.firstFrameReady()` precedes `ytgame.gameReady()`;
  `ytgame.onPause/onResume` replace the Page Visibility API; saves go through
  `ytgame.loadData/saveData`.

> Bundle-size: cert zip is ~11 MiB (dead root-level UI PNGs removed — the game
> only references `assets/ui/*`). Well under the Playables 30 MiB initial cap.
