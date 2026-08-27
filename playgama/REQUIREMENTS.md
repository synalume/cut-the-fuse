# Cut the Fuse — Playgama requirements (build in early)

**Goal:** satisfy Playgama / YouTube Playables distribution **while building**, so certification is Bridge wiring + zip — not a sound/perf rewrite.

**Authoritative lesson source (Big Fluff, Aug 2026 review):**
[`../big-fluff/playgama/REVIEW_PLAYBOOK.md`](../big-fluff/playgama/REVIEW_PLAYBOOK.md)

**Official:** [Self-check](https://wiki.playgama.com/playgama/game-requirements/game-self-check) · [UX](https://wiki.playgama.com/playgama/game-requirements/user-experience-requirements) · [Content](https://wiki.playgama.com/playgama/game-requirements/content-requirements) · [Bridge API](https://wiki.playgama.com/playgama/bridge-sdk/api)

---

## Product stance (Cut the Fuse)

| Topic | Lock |
|-------|------|
| Audience | Hypercasual puzzle, 13+ — not kids / clinical |
| Auth | **No** SDK authorization / login |
| Continue | **Free** retry every fail — never ad-gated (churn trap research; skill must beat the level) |
| Monetization | Interstitial at level clear; rewarded reserved for **cosmetics** later, never progression |
| Engine (form) | Plain JS, JSON-driven levels |
| Exclusivity | Prefer Playgama non-exclusive first |

---

## Audio (build in early)

Playgama rejected Big Fluff for live-procedural music; product audio must be **files in the zip**.

1. **Bake path exists** — `audio/mmaudio-cues.json` + `tools/gen-audio/gen-mmaudio.mjs` → `assets/audio/*`. Synth snip is a dev fallback only.
2. **Loops** (`wick_crackle`, `tension_bed`): seamless **WAV**, crossfaded at bake time — seam clicks fail QA.
3. **Rapid SFX** (`snip`): trimmed to ~0.15s + rate-limited to one hit/60ms — long samples without gaps → echo.
4. **Mute:** in-game mute required; host `AUDIO_STATE_CHANGED` is a veto. Icon must match hearable state.

---

## Bridge / QA (design APIs now)

| Requirement | Rule |
|-------------|------|
| Pause signal | **Always** freeze when host says paused — including while iframe stays **visible** (QA tool) |
| Idle false-pause | Don't ignore visible pause; don't clear host pause on random click/mute |
| Audio host | Mute output when host disables audio; sync button |
| Tab hide | Pause + save |
| Interstitial | Natural break (level clear). Prefer audio duck over full pause so dismiss doesn't skip results |
| Rewarded | Cosmetics only — grant only on rewarded success |
| `game_ready` | When title is interactive |
| Bind once | Don't double-subscribe pause/audio |
| Auth QA step | Answer **No** |
| Network | No external calls in the Playgama zip |

---

## Performance

- Budget for **mid-mobile + iframe**, not only desktop.
- Keep particle/slash density adaptive under load.
- Same gameplay/art — don't "optimize" by gutting readable juice without measuring.

---

## Packaging

```
cut-the-fuse/playgama/
  make-playgama-bundle.sh
  playgama-bridge-config.json
  UPLOAD.md
  covers/   # 800×800, 1080×1920, 1920×1080 exact
  out/cut-the-fuse-playgama.zip
```

Zip: root `index.html`, `src/`, `assets/` (incl. baked audio), Bridge config. No YouTube SDK. No Poki SDK. No `tools/`, `cert/`, `locked-branding/`.

---

## Pre-submit gate

1. Read this file + [UPLOAD.md](./UPLOAD.md).
2. Rebuild zip: `./make-playgama-bundle.sh`.
3. Developer portal → **Test Game** → pause (visible), mute, audio, ads, auth=No.
4. Fix before Update/Submit — not after rejection.
