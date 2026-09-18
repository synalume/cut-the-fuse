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
| Console | No "Before using the SDK you must initialize it" from our code |

4. Submit only after the walk — fix before Update/Submit, not after rejection.

**Current build: 2026-09-18** — `playgama/out/cut-the-fuse-playgama.zip`, 11.31 MiB
(11,863,023 bytes), sha256 `4c2b009625dd0aa8…`, from `main` @ _(this commit)_.
Carries the round-5 fixes (SDK init race + interstitial never reaching the
platform + portal message set). Walk the QA table above before uploading.

## Review rounds

- **2026-09-18 (round 5, pending):** reviewer flagged three things on the
  2026-09-07 zip — "The interstitial ad was not triggered / the platform did not
  intercept an interstitial ad call", the `Before using the SDK you must
  initialize it` error, and "Progress is not restored". All three had real
  causes in our code (verified against the actual `bridge.playgama.com` v2.2.0
  bundle, not just our mock):
  1. **Interstitial never reached the platform.** Two compounding causes.
     (a) The Bridge's ad module only shows an interstitial *after* `game_ready`
     has been sent — it timestamps that message and its `show()` bails out
     while `initialInterstitialDelay` has not elapsed, **failing before it ever
     calls the platform**. Our config set `initialInterstitialDelay: 45`, so a
     level cleared inside the first 45 s produced no platform call at all →
     now `0`. (b) Our `game_ready` send was gated on a *synchronous* read of
     `bridge.platform?.sendMessage` from `loadingFinished()`, and
     `renderer.onAssetsReady()` fires on every asset batch; the message was also
     re-sent on each batch, which the SDK rejects. It is now deduped and queued
     behind Bridge init (`_sendGameReady`).
  2. **`Before using the SDK you must initialize it`.** The Bridge exposes
     `platform` / `storage` / `advertisement` as getters gated on
     `initialize()`, and reading one early makes the SDK log exactly that error
     and return `undefined`. `Platform._boot()` called
     `_bindPlaygamaHostEvents()` immediately (before init resolved), which read
     `bridge.platform`. Nothing touches a Bridge module now until the init
     promise settles (`_playgamaInitialized` gate) and the Bridge global may
     even still be downloading (`_waitForBridge`).
  3. **Progress not restored.** `_save()` dropped writes on a portal build whose
     backend wasn't detectable yet; it now re-detects and holds the snapshot
     until `init()` can flush it. The domain fix (accepting the SDK's
     auto-parsed JSON) landed in round 3 — see below.
  Also: the interstitial now uses the declared placement `level_completed`
  (it was sending an undeclared `level_complete`), and `gameplay_started` /
  `gameplay_stopped` / `level_completed` are reported to the portal.
  `tools/smoke/verify-portal.mjs` now drives its mock from the **real**
  `playgama-bridge-config.json` and models the SDK's module gating, the
  `game_ready` precondition and the initial-delay gate — the old mock exposed
  `platform` unconditionally and had no delay gate, which is why this shipped.
  Zip rebuilt 2026-09-18 (verified 18/18 against the staged zip itself).
- **2026-09-11 (round 4, second fix):** MediaCube flagged a zero-size cold-boot
  latch — "the game started while the frame had zero size, the frame has since
  grown, and the game still has not reached a working state". `new
  Renderer(canvas)` measured the viewport once at module load and the resize
  listeners were only attached at the END of `boot()`, after `levels.json`
  (488 KiB) and save hydration; YouTube grows the frame from 0×0 during exactly
  that window, so the 0×0 measurement was latched (zero-size backing store,
  `--app-h: 0px`, collapsed container, nothing drawn). `Renderer.resize()` now
  refuses a zero measurement instead of latching it, the listeners attach before
  the awaits, and `Renderer.ensureViewport()` polls every frame from
  `GameLoop._frame()` so a *missed* resize event self-corrects on the next
  frame. `firstFrameReady` also no longer announces an empty frame — it fires
  from the loop's first draw at a real size. Regression test:
  `tools/smoke/verify-coldboot-size.mjs` (fails on the pre-fix code). Zip
  rebuilt 2026-09-11.
- **2026-09-11 (round 4, first fix):** fixed the screen-rotation UI alignment
  bug MediaCube reported on the Playables build (same code, so the Playgama zip
  is rebuilt too). Level geometry is laid out as `viewport centre + config
  offset` and the camera is fitted to the build-time viewport, so rotating
  refitted the canvas but left the *level* and its world-space marks (cut marks,
  gold stars, hint markers) laid out for the old orientation — only re-entering
  the level rebuilt it. New `relayoutLevel()` (`LevelManager.js`) re-centres a
  built level in place and `game.relayout()` (`GameLoop.js`) re-fits the camera
  and moves the world-space state; `main.js` routes `resize`,
  `visualViewport.resize` and `orientationchange` through the single
  `renderer.onViewportChange` hook. Progress is untouched. Regression test:
  `tools/smoke/verify-rotation.mjs`. Zip rebuilt 2026-09-11 (`make-playgama-bundle.sh`).
- **2026-09-07 (round 3):** reviewer reported "Progress is not restored" after
  reload (save did fire). Root cause: real Bridge v2 `storage.get` auto-parses
  stored JSON on read (`tryParseJson` defaults true), so the save — a JSON
  *string* — came back as an already-parsed *object*, and `load`'s
  `typeof === "string"` guard treated it as "no data" → fresh defaults on every
  reload. Fix in `SaveManager.js`: the Playgama load accepts a string OR a
  parsed object (normalizes via `JSON.stringify`). `verify-playgama-save.mjs`
  upgraded to a cross-reload regression test with a faithful auto-parse mock
  (the old mock was same-session only and couldn't catch this). Zip rebuilt.
- **2026-09-02 (round 2, resubmitted):** reviewer hit an intermittent cold-start
  crash — `TypeError: can't access property "level_id", this.level is null` in
  `_finishLevel`. Cause: the render loop starts at the top of `boot()` (before
  a level loads, so firstFrameReady fires on the first painted frame), and with
  no level present an empty spark list in the PLAYING state ran the win/lose
  check on a null level. Fix (in `src/engine/GameLoop.js`, applies to ALL
  builds, not just Playgama): `_update()` and `_finishLevel()` both bail when
  `!this.level`. Zip rebuilt from current `main` and cold-start walked with no
  errors.
  - _Correction (round 5):_ this entry originally claimed the
    `Before using the SDK you must initialize it` line was only Bridge's own
    informational startup log and "not an app error". **That was wrong.**
    `Platform._boot()` was reading `bridge.platform` before `initialize()`
    resolved, and the Bridge logs that exact message when a module is touched
    early. Fixed in round 5 — do not re-add a pre-init Bridge read.
- **2026-08-31 (round 1):** initial submission.

## Covers (exact sizes)

Place final covers in `playgama/covers/` before upload:

- `800x800.png` (game icon)
- `1080x1920.png` (portrait cover)
- `1920x1080.png` (landscape cover)

Placeholders live in `covers/` — generate with the art queue once the hero bomb is approved.
