# Cut the Fuse — MMAudio cue plan

All product audio the game needs, generated one cue at a time via
**MuAPI MMAudio v2** so each clip can be heard and approved before re-baking.

**Generate:** `node tools/gen-audio/gen-mmaudio.mjs <cue>`
**Listen:** `audio/mmaudio_staging/<cue>/`  **Approve:** `... <cue> --status approved`
**Trim to single hit:** `... process <cue> --take v2` → writes `audio/samples/baked/<cue>.mp3`

## Cue list

| Cue | Kind | Type | Req. dur | What it is / when it plays | Status |
|-----|------|------|----------|----------------------------|--------|
| `ignite` | one-shot | sound_effect | 1.2s (trimmed to 0.8s) | Matchstick striking at ignition — plays the moment a spark starts burning | **approved** |
| `snip` | one-shot | sound_effect | 1s (trimmed to 0.15s) | Razor shears cutting a fuse — the core feedback for every snip | **approved** |
| `dud` | one-shot | sound_effect | 1s (trimmed to 0.6s) | Spark snuffed out in a cut gap — a sad fizzle | **approved** |
| `blast` | one-shot | sound_effect | 2s (trimmed to 1.2s) | Bomb detonation on failure — big but cartoonish | **approved** |
| `win_star` | one-shot | sound_effect | 1s (trimmed to 0.16s) | Coin ping as each star lights in the win modal — ascending pitch per star | **approved** |
| `win` | one-shot | music_sting | 0.8s (sting) | Level-clear fanfare: a short ascending fanfare that lands the win beat (synth fallback plays a C5-E5-G5-C6 arpeggio until baked) | pending |
| `wick_crackle` | loop | sound_effect | 3s (loop seed) | Fuse wick burning bed — plays while any spark is travelling | **approved** |

## Notes

1. **One-shots** (6): requested ~1–2s and trimmed to the game's play length at bake time
   (`AudioManager` plays the whole baked buffer). The trim also prevents echo stacking on rapid
   snip triggers — `snip` plays at 0.15s and is rate-limited to one hit per 60ms. The `win` sting
   is the exception: it's a composed 0.8s fanfare, not a trimmed foley hit.
2. **Loops** (1): request a short 3s seed, then crossfade + shorten it into a seamless WAV at bake time
   (the `process` command does loop-seam crossfade). Do NOT ship an un-looped seed.
3. **Prompt grammar** (learned from the big-fluff pipeline): material + action + mic placement +
   explicit negatives (`no music`, `no voice`, `no hum`, `no drone`). Avoid long “ambience” prompts —
   they collapse to a low hum. Keep seeds short and discrete.
4. **Humanization:** the game already adds per-hit pitch/level drift on top (`AudioManager`), so a
   single good take per cue reads as hand-played.
5. **Cost:** ~$0.14/clip → 6 MMAudio cues × ~2 candidate takes ≈ **$2**. This replaces recorded foley
   for SFX; the `tension_bed` music is a composer bake (see note 6).
6. **Music bed is not MMAudio:** `tension_bed` is baked by a composer (the big-fluff lesson: MMAudio
   music beds collapse into a low hum). It ships as `audio/samples/baked/tension_bed.wav` and loops
   under every level, stopping on results screens.

## Approved → re-bake path

1. Mark each cue approved (`--status approved`) once a take passes by ear.
2. Trim/normalize/loop the approved takes into `audio/samples/baked/` with the same filenames
   (`snip.mp3`, `wick_crackle.wav`, …). The game picks them up automatically.
3. `./playgama/make-playgama-bundle.sh` → ships `assets/audio/*`.
4. Until a cue is baked, `AudioManager` falls back to the synth snip — dev builds stay playable.

