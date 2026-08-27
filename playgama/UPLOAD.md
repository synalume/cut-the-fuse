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

## Covers (exact sizes)

Place final covers in `playgama/covers/` before upload:

- `800x800.png` (game icon)
- `1080x1920.png` (portrait cover)
- `1920x1080.png` (landscape cover)

Placeholders live in `covers/` — generate with the art queue once the hero bomb is approved.
