# Cut the Fuse — Playgama upload

1. `./playgama/make-playgama-bundle.sh`
2. https://developer.playgama.com → Add Game → upload `playgama/out/cut-the-fuse-playgama.zip`
3. **Test Game** in the portal, walk the QA checklist:

| Check | Expect |
|-------|--------|
| Pause (visible iframe) | Game freezes; resumes on host resume |
| Pause (hidden tab) | Game freezes + saves |
| Mute | Button icon matches muted state; host veto respected |
| Audio | Baked files play; no echo stacking on rapid snips |
| Interstitial | Appears at level clear, not mid-game |
| Rewarded | Cosmetic only; grants only on success |
| Auth | Answer **No** |
| Loading | `gameReady` fires when the title is interactive |

4. Submit only after the walk — fix before Update/Submit, not after rejection.

## Review rounds

- **2026-09-02 (round 2, resubmitted):** reviewer hit an intermittent cold-start
  crash — `TypeError: can't access property "level_id", this.level is null` in
  `_finishLevel`. Cause: the render loop starts at the top of `boot()` (before
  a level loads, so firstFrameReady fires on the first painted frame), and with
  no level present an empty spark list in the PLAYING state ran the win/lose
  check on a null level. Fix (in `src/engine/GameLoop.js`, applies to ALL
  builds, not just Playgama): `_update()` and `_finishLevel()` both bail when
  `!this.level`. The Playgama "Before using the SDK you must initialize it"
  console line is Bridge's own informational startup log — the game awaits
  `bridge.initialize()` before any SDK call, so it is not an app error. Zip
  rebuilt from current `main` and cold-start walked with no errors.
- **2026-08-31 (round 1):** initial submission.

## Covers (exact sizes)

Place final covers in `playgama/covers/` before upload:

- `800x800.png` (game icon)
- `1080x1920.png` (portrait cover)
- `1920x1080.png` (landscape cover)

Placeholders live in `covers/` — generate with the art queue once the hero bomb is approved.
