// Renders audio/AUDIO_CUE_PLAN.md from audio/mmaudio-cues.json (source of truth).
export function renderCuePlanDoc(cues, statuses = {}) {
  const lines = [];
  lines.push("# Cut the Fuse — MMAudio cue plan");
  lines.push("");
  lines.push("All product audio the game needs, generated one cue at a time via");
  lines.push("**MuAPI MMAudio v2** so each clip can be heard and approved before re-baking.");
  lines.push("");
  lines.push("**Generate:** `node tools/gen-audio/gen-mmaudio.mjs <cue>`");
  lines.push("**Listen:** `audio/mmaudio_staging/<cue>/`  **Approve:** `... <cue> --status approved`");
  lines.push("**Trim to single hit:** `... process <cue> --take v2` → writes `audio/samples/baked/<cue>.mp3`");
  lines.push("");
  lines.push("## Cue list");
  lines.push("");
  lines.push("| Cue | Kind | Type | Req. dur | What it is / when it plays | Status |");
  lines.push("|-----|------|------|----------|----------------------------|--------|");
  for (const c of cues) {
    const dur =
      c.kind === "loop"
        ? `${c.durationSec}s (loop seed)`
        : c.playSec != null && c.playSec >= c.durationSec
          ? `${c.durationSec}s (kept full)`
          : `${c.durationSec}s (trimmed to ${c.playSec}s)`;
    const st = statuses[c.id];
    const label = st?.approved
      ? c.source === "composer-bake"
        ? "**approved** (composer bake)"
        : "**approved**"
      : "pending";
    lines.push(`| \`${c.id}\` | ${c.kind} | ${c.soundType} | ${dur} | ${c.role} | ${label} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(`1. **One-shots** (${cues.filter((c) => c.kind === "one-shot").length}): requested ~1–2s and trimmed to the game's play length at bake time`);
  lines.push("   (`AudioManager` plays the whole baked buffer). The trim also prevents echo stacking on rapid");
  lines.push("   snip triggers — `snip` plays at 0.15s and is rate-limited to one hit per 60ms.");
  lines.push(`2. **Loops** (${cues.filter((c) => c.kind === "loop").length}): request a short 3s seed, then crossfade + shorten it into a seamless WAV at bake time`);
  lines.push("   (the `process` command does loop-seam crossfade). Do NOT ship an un-looped seed.");
  lines.push("3. **Prompt grammar** (learned from the big-fluff pipeline): material + action + mic placement +");
  lines.push("   explicit negatives (`no music`, `no voice`, `no hum`, `no drone`). Avoid long “ambience” prompts —");
  lines.push("   they collapse to a low hum. Keep seeds short and discrete.");
  lines.push("4. **Humanization:** the game already adds per-hit pitch/level drift on top (`AudioManager`), so a");
  lines.push("   single good take per cue reads as hand-played.");
  lines.push("5. **Cost:** ~$0.14/clip → 6 MMAudio cues × ~2 candidate takes ≈ **$2**. This replaces recorded foley");
  lines.push("   for SFX; the `tension_bed` music is a composer bake (see note 6).");
  lines.push(`6. **Music bed is not MMAudio:** \`tension_bed\` is baked by a composer (the big-fluff lesson: MMAudio`);
  lines.push("   music beds collapse into a low hum). It ships as `audio/samples/baked/tension_bed.wav` and loops");
  lines.push("   under every level, stopping on results screens.");
  lines.push("");
  lines.push("## Approved → re-bake path");
  lines.push("");
  lines.push("1. Mark each cue approved (`--status approved`) once a take passes by ear.");
  lines.push("2. Trim/normalize/loop the approved takes into `audio/samples/baked/` with the same filenames");
  lines.push("   (`snip.mp3`, `wick_crackle.wav`, …). The game picks them up automatically.");
  lines.push("3. `./playgama/make-playgama-bundle.sh` → ships `assets/audio/*`.");
  lines.push("4. Until a cue is baked, `AudioManager` falls back to the synth snip — dev builds stay playable.");
  lines.push("");
  return lines.join("\n") + "\n";
}
