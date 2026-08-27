# Cut the Fuse — Playables certification checklist

YouTube Playables / MC Play upload. Build: `./cert/make-bundle.sh` → `cert/out/cut-the-fuse-playables.zip`.

## Pre-build

- [ ] Placeholder art in `assets/` (lvl1 set) + baked audio in `assets/audio/` (or synth fallback flagged in build log)
- [ ] `src/data/levels.json` validates with zero warnings (`node tools/level-gen/gen-levels.mjs`)
- [ ] 60-level ladder playable end-to-end; no black-hole levels (analytics: attempts per level)

## Bundle gate (script enforces)

- [ ] YouTube game_api script present, no Playgama Bridge, no Poki SDK
- [ ] `__CUT_THE_FUSE_PLAYABLES__ = true` flag injected
- [ ] No `tools/`, `cert/`, `locked-branding/` in zip
- [ ] All filenames `[A-Za-z0-9._-]` (script checks)
- [ ] Zip `< 30 MiB` initial (target `< 10 MiB` with placeholder assets)

## QA walk (in the Playables test environment)

- [ ] Esc closes every modal (tutorial, win, lose, DDA, skins, end screen)
- [ ] "No more content" screen after level 60, with replay
- [ ] Progress saves between sessions (stars, unlocked level)
- [ ] Pause on tab hide; resume continues
- [ ] Zero external network calls (no analytics, no CDN) — `Analytics` is disabled by the flag
- [ ] Audio files play from the zip (no live-only synth bed)

## Ref (Mediacube / review bookmarks)

- Big Fluff cert checklist: [`../big-fluff/cert/CHECKLIST.md`](../big-fluff/cert/CHECKLIST.md)
- Mediacube and Playables policies re-checked before submit
