#!/usr/bin/env node
/**
 * Cut the Fuse — MMAudio cue generator (one cue at a time, MuAPI).
 * Ported from the big-fluff pipeline.
 *
 * Generates candidate takes for a single audio cue so you can listen and approve
 * before the pack is re-baked. Cue list + prompts live in audio/mmaudio-cues.json.
 *
 * Usage:
 *   node gen-mmaudio.mjs list                       # show the cue table
 *   node gen-mmaudio.mjs snip                       # 3 candidate takes of 'snip'
 *   node gen-mmaudio.mjs snip --variants 2
 *   node gen-mmaudio.mjs snip --prompt "custom prompt" --duration 1
 *   node gen-mmaudio.mjs snip --status approved     # mark a cue approved (no generation)
 *   node gen-mmaudio.mjs status                      # show approval status
 *   node gen-mmaudio.mjs process snip --take v2      # trim+bake the approved take
 *   node gen-mmaudio.mjs wire                        # copy baked samples into assets/audio/
 *   node gen-mmaudio.mjs --docs                       # regenerate audio/AUDIO_CUE_PLAN.md
 *
 * Output: audio/mmaudio_staging/<cue>/<cue>_v1.mp3 …
 * Status: audio/mmaudio-staging-status.json
 * Baked:  audio/samples/baked/<cue>.mp3 (or .wav + .mp3 for loops)
 *
 * API key: $MUAPI_KEY, or tools/gen-audio/.env, or
 *          synalume-workspace/synalume-marketing/.env (sibling repo).
 */
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = __dirname;
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const CUES_JSON = path.join(REPO_ROOT, "audio", "mmaudio-cues.json");
const STAGING_DIR = path.join(REPO_ROOT, "audio", "mmaudio_staging");
const STATUS_FILE = path.join(REPO_ROOT, "audio", "mmaudio-staging-status.json");

const MUAPI_BASE = "https://api.muapi.ai/api/v1";
const POLL_TIMEOUT_MS = 420_000; // MMAudio commonly takes 1–3 min
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_VARIANTS = 3;
/* A real hit peaks around -12..-1 dB. MMAudio occasionally returns a near-silent
   clip; anything below this gets regenerated automatically (max 3 attempts). */
const SILENT_DB = -25;
/* All baked one-shots are peak-normalized to this max level (dBFS) so every cue
   plays at the same loudness in-game. -3 dB leaves headroom for the game's
   humanization drift (0.86..1.08 x) and master gain without clipping. */
const NORM_TARGET_PEAK = -3;

/** Baked filename convention — mirrors AudioManager's cue registry: one-shots
 *  ship as MP3, loops as WAV (+ MP3 fallback). */
function cueFile(cue) {
  return cue.kind === "loop" ? `${cue.id}.wav` : `${cue.id}.mp3`;
}

async function readdirSafe(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/* ---------- env / key ---------- */

function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

async function loadApiKey() {
  if (process.env.MUAPI_KEY) return process.env.MUAPI_KEY.trim();
  const candidates = [
    path.join(TOOL_ROOT, ".env"),
    path.join(REPO_ROOT, ".env"),
    path.resolve(REPO_ROOT, "..", "synalume-workspace", "synalume-marketing", ".env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const env = parseDotEnv(await readFile(p, "utf8"));
    if (env.MUAPI_KEY) return env.MUAPI_KEY.trim();
  }
  throw new Error(
    "MUAPI_KEY not found. Set it in the environment or tools/gen-audio/.env (see synalume-marketing/.env)."
  );
}

/* ---------- MuAPI client (mirrors synalume-marketing muapi/client.ts) ---------- */

async function muapiPostJson(apiKey, apiPath, body) {
  const res = await fetch(`${MUAPI_BASE}/${apiPath.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MuAPI POST ${apiPath} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error(`MuAPI POST ${apiPath} returned no request_id.`);
  return String(requestId);
}

async function muapiPoll(apiKey, requestId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${MUAPI_BASE}/predictions/${encodeURIComponent(requestId)}/result`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MuAPI poll failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const result = await res.json();
    const status = String(result.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded") return result;
    if (status === "failed" || status === "error") {
      throw new Error(result.error ?? `MuAPI job ${requestId} failed.`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`MuAPI job ${requestId} timed out after ${POLL_TIMEOUT_MS}ms.`);
}

function extractAudioUrl(result) {
  const output = result.output;
  if (typeof output === "string" && output.startsWith("http")) return output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    for (const key of ["audio_url", "url", "audio", "output"]) {
      if (typeof output[key] === "string" && output[key].startsWith("http")) return output[key];
    }
  }
  if (Array.isArray(result.outputs)) {
    for (const item of result.outputs) {
      if (typeof item === "string" && item.startsWith("http")) return item;
      if (item && typeof item === "object") {
        if (typeof item.url === "string") return item.url;
        if (typeof item.audio_url === "string") return item.audio_url;
      }
    }
  }
  throw new Error("MuAPI result did not contain an audio URL.");
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} failed (${res.status})`);
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

/* ---------- status ---------- */

async function readStatus() {
  try {
    return JSON.parse(await readFile(STATUS_FILE, "utf8"));
  } catch {
    return {};
  }
}

/* ---------- take processing (trim to a single hit) ---------- */

function execFile(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))
    );
  });
}

async function silenceEvents(file, noiseDb = -30, d = 0.03) {
  const { err } = await execFile("ffmpeg", [
    "-hide_banner", "-i", file,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${d}`,
    "-f", "null", "-",
  ]);
  const starts = [];
  const ends = [];
  for (const m of err.matchAll(/silence_start:\s*([0-9.]+)/g)) starts.push(Number(m[1]));
  for (const m of err.matchAll(/silence_end:\s*([0-9.]+)/g)) ends.push(Number(m[1]));
  return { starts, ends };
}

async function maxPeakDb(file) {
  const { err } = await execFile("ffmpeg", [
    "-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-",
  ]);
  const m = err.match(/max_volume:\s*(-?[0-9.]+) dB/);
  return m ? Number(m[1]) : -Infinity;
}

/* Find the first short-window RMS that rises above `thresholdDb`. Handles takes
   with a quiet noise floor up front and a louder hit starting mid-file (the
   silence-based detector can't distinguish those). Returns seconds (0 = none). */
async function rmsOnsetSec(file, thresholdDb = -26) {
  const { err } = await execFile("ffmpeg", [
    "-hide_banner", "-i", file,
    "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-",
  ]);
  const wins = [];
  for (const m of err.matchAll(/RMS_level=(-?[0-9.]+)/g)) wins.push(Number(m[1]));
  if (!wins.length) return 0;
  const winSec = 0.0116; // 1024-sample window @ 44.1kHz
  for (let i = 0; i < wins.length; i++) {
    if (wins[i] > thresholdDb) return Math.max(0, i * winSec - 0.015); // back off 15ms before the loud onset
  }
  return 0;
}

/* Peak-normalize a file to NORM_TARGET_PEAK so every cue hits the same level.
   (loudnorm targets integrated LUFS and is meant for long-form audio; short SFX
   hits need consistent PEAK level instead or quiet cues get buried.) */
async function normalizePeak(file, targetDb = NORM_TARGET_PEAK) {
  const cur = await maxPeakDb(file);
  if (!Number.isFinite(cur)) throw new Error(`Could not measure peak of ${file}`);
  const gain = targetDb - cur;
  const tmp = `${file}.norm.mp3`;
  await execFile("ffmpeg", [
    "-y", "-hide_banner", "-i", file,
    "-af", `volume=${gain.toFixed(2)}dB`,
    "-codec:a", "libmp3lame", "-q:a", "4",
    tmp,
  ]);
  await execFile("mv", [tmp, file]);
  console.log(`  → peak-normalized to ${targetDb} dB (applied ${gain >= 0 ? "+" : ""}${gain.toFixed(2)} dB)`);
}

/* MMAudio often pads a ~1s clip with several repeats of the same hit. The game
   plays only the first `playSec` of the buffer, so an approved take must be cut
   to ONE hit starting near t=0. Detect the first pop, keep a small pre-roll and
   a short natural tail, drop the rest, and peak-normalize. */
async function processTake(cue, take, opts = {}) {
  const takeName = /^v?\d+$/.test(take) ? `v${take.replace(/^v/, "")}` : take;
  const src = path.join(STAGING_DIR, cue.id, `${cue.id}_${takeName}.mp3`);
  if (!existsSync(src)) throw new Error(`Take not found: ${path.relative(REPO_ROOT, src)}`);

  const noise = opts.noise ?? -30;
  const { starts, ends } = await silenceEvents(src, noise);
  const { out: srcDurOut } = await execFile("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", src,
  ]);
  const srcDur = Number(srcDurOut.trim()) || 0;
  /* `ends[0]` is only the first-hit onset if the file OPENS with silence. When
     audio starts at t=0 (common for soft/airy takes), `starts[0]` marks the end
     of the first hit, not a leading gap — and `ends[0]` can point at the tail.
     A near-EOF onset is a misread: fall back to 0. */
  const hasLeadingSilence = starts[0] != null && starts[0] < 0.03;
  let onset = hasLeadingSilence ? (ends[0] ?? 0) : 0;
  if (srcDur - onset < 0.1) onset = 0;
  /* When the file doesn't open with a clean leading silence (quiet noise floor
     up front, real hit starting mid-file), fall back to the RMS-based onset so
     we don't trim the quiet intro as if it were the hit. */
  if (!hasLeadingSilence) {
    const rmsOnset = await rmsOnsetSec(src, -26);
    if (rmsOnset > 0.03 && rmsOnset < srcDur - 0.05) onset = rmsOnset;
  }
  /* A raw take sometimes opens with an abrupt click/transient (audio from t=0).
     --skip trims that off so the file starts at the real hit. */
  const skip = opts.skip ?? 0;
  let firstEnd = starts.find((s) => s > onset + skip + 0.03);
  const pre = 0.015;
  const tail = 0.05;
  const start = Math.max(0, onset + skip - (skip > 0 ? 0 : pre));
  const end = opts.dur != null
    ? Math.min(start + opts.dur, onset + skip + 0.5)
    : firstEnd ? Math.min(firstEnd + tail, onset + skip + 0.4) : Math.min(onset + skip + 0.3, start + 0.3);
  if (end - start < 0.04) throw new Error(`Trim window too small (${(end - start).toFixed(3)}s) — try a lower --noise threshold.`);

  console.log(`[${cue.id}] take ${takeName}: first pop at ${(onset + skip).toFixed(3)}s (skip ${skip.toFixed(3)}s), trim ${start.toFixed(3)}s → ${end.toFixed(3)}s (${(end - start).toFixed(3)}s)`);

  const outDir = path.join(REPO_ROOT, "audio", "samples", "baked");
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${cue.id}.mp3`);
  await execFile("ffmpeg", [
    "-y", "-hide_banner", "-i", src,
    "-ss", start.toFixed(3), "-t", (end - start).toFixed(3),
    "-codec:a", "libmp3lame", "-q:a", "4",
    out,
  ]);
  await normalizePeak(out);

  const { starts: outStarts, ends: outEnds } = await silenceEvents(out, noise);
  const { out: durOut } = await execFile("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", out,
  ]);
  const dur = Number(durOut.trim()) || 0;
  if (dur < 0.04) {
    throw new Error(`Trim produced an empty/too-short output (${dur.toFixed(3)}s) — inspect the source and pass --skip/--dur explicitly.`);
  }
  // A gap between hits is a silence that ends before the file ends (trailing silence isn't a gap).
  const hits = outEnds.filter((e) => e < dur - 0.02).length + 1;
  console.log(`  → wrote ${path.relative(REPO_ROOT, out)} (${(end - start).toFixed(3)}s, ~${hits} hit(s))`);
  console.log(`  verify: ffplay "${out}"`);
  return out;
}

/* Loops: decode the approved seed to WAV, crossfade the tail into the head to
   hide the loop seam (same idea as make_foley_pack.crossfade_loop), then write
   WAV (game's preferred loop format) + MP3 fallback, peak-normalized. */
async function processLoopTake(cue, take, opts = {}) {
  const takeName = /^v?\d+$/.test(take) ? `v${take.replace(/^v/, "")}` : take;
  const src = path.join(STAGING_DIR, cue.id, `${cue.id}_${takeName}.mp3`);
  if (!existsSync(src)) throw new Error(`Take not found: ${path.relative(REPO_ROOT, src)}`);

  const outDir = path.join(REPO_ROOT, "audio", "samples", "baked");
  await mkdir(outDir, { recursive: true });
  const wavOut = path.join(outDir, `${cue.id}.wav`);
  const mp3Out = path.join(outDir, `${cue.id}.mp3`);

  console.log(`[${cue.id}] take ${takeName}: crossfade-loop bake`);
  const fade = opts.fade ?? 0.08;
  /* Decode to raw PCM, then crossfade the tail into the head (same seam-hiding
     technique as make_foley_pack.crossfade_loop) and write WAV + MP3. */
  const pcmOut = path.join(outDir, `${cue.id}.raw`);
  await execFile("ffmpeg", [
    "-y", "-hide_banner", "-i", src,
    "-f", "f32le", "-acodec", "pcm_f32le", "-ar", "44100", "-ac", "1",
    pcmOut,
  ]);
  const script = `
import numpy as np
src = r"${pcmOut}"
out = r"${wavOut}"
sr = 44100
x = np.fromfile(src, dtype=np.float32).astype(np.float64)
fade_n = max(8, int(${fade} * sr))
fade_n = min(fade_n, len(x) // 4)
ramp = np.linspace(0.0, 1.0, fade_n)
x[:fade_n] = x[:fade_n] * ramp + x[-fade_n:] * (1.0 - ramp)
x = x[:-fade_n]
m = np.max(np.abs(x)) or 1.0
x = x * (0.71 / m)   # peak ~0.71 (~ -3 dB)
pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16)
import wave
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(pcm.tobytes())
`;
  const py = path.join(REPO_ROOT, "audio", "samples", "baked", `_xfade_${cue.id}.py`);
  await writeFile(py, script);
  try {
    await execFile("python3", [py]);
  } finally {
    await execFile("rm", ["-f", pcmOut, py]);
  }
  await execFile("ffmpeg", ["-y", "-hide_banner", "-i", wavOut, "-codec:a", "libmp3lame", "-q:a", "4", mp3Out]);
  console.log(`  → wrote ${path.relative(REPO_ROOT, wavOut)} + ${path.relative(REPO_ROOT, mp3Out)}`);
  return wavOut;
}

/* ---------- main ---------- */

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderReviewPage(rows, statuses) {
  const body = rows
    .map(({ cue, takes, baked }) => {
      const st = statuses[cue.id];
      const label = st?.approved ? "✓ APPROVED" : "pending";
      const takeBlock = takes.length
        ? takes
            .map(
              (t, i) => `<div class="row"><span>${esc(t.match(/\/([^/]+)\.\w+$/)?.[1] || `take ${i + 1}`)}</span>
                <audio controls preload="none" src="/audio/${esc(t)}"></audio>
                <code>${esc(t)}</code></div>`
            )
            .join("\n")
        : `<div class="muted">no takes yet — generate with <code>node gen-mmaudio.mjs ${cue.id}</code></div>`;
      const bakedBlock = baked.length
        ? baked
            .map(
              (b) => `<div class="row"><span class="baked">BAKED</span>
                <audio controls preload="none" src="/audio/${esc(b)}"></audio>
                <code>${esc(b)}</code></div>`
            )
            .join("\n")
        : `<div class="muted">not baked — after approving, run <code>process ${cue.id}</code> + <code>wire ${cue.id}</code></div>`;
      return `<section class="cue">
        <h2>${esc(cue.id)} <span class="status ${label.includes("APPROVED") ? "ok" : ""}">${label}</span></h2>
        <p class="role">${esc(cue.role)}</p>
        ${takeBlock}
        ${bakedBlock}
      </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cut the Fuse — audio cue review</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; background: #f5f2ec; color: #222; }
  h1 { font-size: 20px; letter-spacing: 0.05em; text-transform: uppercase; }
  .cue { border: 2px solid #ddd; background: #fffdf8; border-radius: 8px; padding: 14px 16px; margin: 14px 0; }
  h2 { margin: 0 0 4px; font-size: 16px; display: flex; gap: 10px; align-items: center; }
  .status { font-size: 11px; color: #8a6d3b; background: #fcf3dc; padding: 2px 8px; border-radius: 10px; }
  .status.ok { color: #276749; background: #e2f3ea; }
  .role { color: #666; font-size: 13px; margin: 0 0 10px; }
  .row { display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap; }
  .row span { width: 74px; font-size: 12px; color: #444; font-weight: 600; }
  .row span.baked { color: #276749; }
  .row audio { height: 30px; }
  .row code { font-size: 11px; color: #888; }
  .muted { color: #999; font-size: 12px; }
</style></head><body>
<h1>Cut the Fuse — audio cue review</h1>
<p>Click play on any take. Once you approve a cue, bake + wire it:
<code>node gen-audio/gen-mmaudio.mjs process &lt;cue&gt;</code> then <code>node gen-audio/gen-mmaudio.mjs wire &lt;cue&gt;</code></p>
${body}
</body></html>`;
}

function printTable(cues, statuses) {
  console.log("\nCut the Fuse — MMAudio cue plan (" + cues.length + " cues)\n");
  console.log(
    ["CUE".padEnd(18), "KIND".padEnd(9), "TYPE".padEnd(14), "DUR", "STATUS"].join("  ")
  );
  console.log("-".repeat(70));
  for (const c of cues) {
    const st = statuses[c.id];
    const label = st?.approved ? "APPROVED" : "pending";
    console.log(
      [c.id.padEnd(18), c.kind.padEnd(9), c.soundType.padEnd(14), String(c.durationSec).padEnd(4), label].join("  ")
    );
  }
  console.log("\nGenerate one at a time:  node gen-mmaudio.mjs <cue>\n");
}

async function generateCue(cue, variants, overrides) {
  const apiKey = await loadApiKey();
  const prompts = cue.prompts || [cue.prompt];
  const dir = path.join(STAGING_DIR, cue.id);
  await mkdir(dir, { recursive: true });

  const data = JSON.parse(await readFile(CUES_JSON, "utf8"));
  const suffix = cue.suffix ?? (cue.kind === "loop" ? data.loopSuffix : data.oneShotSuffix);

  const maxLevel = async (file) => {
    try {
      const { err } = await execFile("ffmpeg", [
        "-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-",
      ]);
      const m = err.match(/max_volume:\s*(-?[0-9.]+) dB/);
      return m ? Number(m[1]) : -Infinity;
    } catch {
      return -Infinity;
    }
  };

  console.log(`\n[${cue.id}] ${cue.role}`);
  for (let k = 1; k <= variants; k++) {
    const prompt = overrides.prompt || prompts[(k - 1) % prompts.length];
    const fullPrompt = `${prompt}. ${suffix}`;
    const duration = overrides.duration ?? cue.durationSec ?? 1;
    const soundType = overrides.soundType ?? cue.soundType ?? "sound_effect";
    console.log(`\n→ take ${k}/${variants} (${soundType}, ${duration}s)`);
    console.log(`  prompt: ${fullPrompt}`);
    const ext = ".mp3";
    const dest = path.join(dir, `${cue.id}_v${k}${ext}`);
    let level = -Infinity;
    for (let attempt = 1; attempt <= 3 && level < SILENT_DB; attempt++) {
      if (attempt > 1) console.log(`  ⚠ silent take — regenerating (attempt ${attempt}/3)`);
      const requestId = await muapiPostJson(apiKey, "mmaudio-v2/text-to-audio", {
        prompt: fullPrompt,
        sound_type: soundType,
        duration: Math.max(1, Math.round(duration)),
      });
      console.log(`  submitted ${requestId} — polling…`);
      const result = await muapiPoll(apiKey, requestId);
      const url = extractAudioUrl(result);
      await downloadToFile(url, dest);
      level = await maxLevel(dest);
      console.log(`  saved ${path.relative(REPO_ROOT, dest)}  (max ${level.toFixed(1)} dB)`);
    }
    if (level < SILENT_DB) {
      console.error(`  ✗ take ${k} is silent (max ${level.toFixed(1)} dB) after 3 attempts — skipping; try regenerating later.`);
    }
  }
  console.log(`\nListen: open ${path.relative(REPO_ROOT, dir)}/`);
}

async function main() {
  const args = process.argv.slice(2);
  const cueId = args.find((a) => !a.startsWith("--"));
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (name) => args.includes(name);

  const cues = JSON.parse(await readFile(CUES_JSON, "utf8")).cues;
  const statuses = await readStatus();

  if (has("--docs")) {
    // Regenerate the plan document from the JSON source of truth + live status.
    const { renderCuePlanDoc } = await import("./write-cue-plan.mjs");
    await writeFile(path.join(REPO_ROOT, "audio", "AUDIO_CUE_PLAN.md"), renderCuePlanDoc(cues, statuses));
    console.log("Wrote audio/AUDIO_CUE_PLAN.md");
    return;
  }

  if (!cueId || has("list")) {
    printTable(cues, statuses);
    if (!cueId) {
      console.log('Generate a cue:  node gen-mmaudio.mjs <cue>\n  e.g. node gen-mmaudio.mjs collect');
      process.exit(1);
    }
    return;
  }

  if (cueId === "status") {
    printTable(cues, statuses);
    return;
  }

  if (cueId === "process") {
    const target = args.find((a) => !a.startsWith("--") && a !== "process");
    if (!target) {
      console.error("Usage: node gen-mmaudio.mjs process <cue> [--take v2] [--skip 0.035] [--dur 0.147] [--noise -30]");
      process.exit(1);
    }
    const cue = cues.find((c) => c.id === target);
    if (!cue) {
      console.error(`Unknown cue '${target}'.`);
      process.exit(1);
    }
    const take = flag("--take") ?? "v1";
    const noise = flag("--noise") ? Number(flag("--noise")) : undefined;
    const skip = flag("--skip") ? Number(flag("--skip")) : undefined;
    const dur = flag("--dur") ? Number(flag("--dur")) : undefined;
    if (cue.kind === "loop") {
      await processLoopTake(cue, take, { noise, skip, dur });
    } else {
      await processTake(cue, take, { noise, skip, dur });
    }
    return;
  }

  if (cueId === "norm") {
    const targets = args.filter((a) => !a.startsWith("--") && a !== "norm");
    const all = targets.length === 0;
    for (const c of cues) {
      if (!all && !targets.includes(c.id)) continue;
      const f = path.join(REPO_ROOT, "audio", "samples", "baked", cueFile(c));
      if (!existsSync(f)) continue;
      await normalizePeak(f);
      console.log(`  ${c.id}: ok`);
    }
    return;
  }

  if (cueId === "wire") {
    // Copy baked samples into assets/audio/ — the path the game loads from.
    const targets = args.filter((a) => !a.startsWith("--") && a !== "wire");
    const all = targets.length === 0;
    const bakedDir = path.join(REPO_ROOT, "audio", "samples", "baked");
    const destDir = path.join(REPO_ROOT, "assets", "audio");
    if (!existsSync(destDir)) await mkdir(destDir, { recursive: true });
    let wired = 0;
    for (const c of cues) {
      if (!all && !targets.includes(c.id)) continue;
      const file = cueFile(c);
      const src = path.join(bakedDir, file);
      if (!existsSync(src)) continue;
      await execFile("cp", [src, path.join(destDir, file)]);
      console.log(`  wired ${file} → assets/audio/`);
      wired++;
    }
    if (wired === 0) console.log("Nothing to wire yet — bake an approved take first (`process <cue>`).");
    return;
  }

  if (cueId === "review") {
    // Write audio/AUDIO_REVIEW.html — click-play all takes + baked versions.
    const stagingDir = path.join(REPO_ROOT, "audio", "mmaudio_staging");
    const bakedDir = path.join(REPO_ROOT, "audio", "samples", "baked");
    const rows = [];
    for (const c of cues) {
      const takes = [];
      const dir = path.join(stagingDir, c.id);
      if (existsSync(dir)) {
        for (const f of (await readdirSafe(dir)).sort()) {
          if (/\.(mp3|wav)$/i.test(f)) takes.push(`mmaudio_staging/${c.id}/${f}`);
        }
      }
      const baked = [];
      for (const ext of ["mp3", "wav"]) {
        const f = path.join(bakedDir, `${c.id}.${ext}`);
        if (existsSync(f)) baked.push(`samples/baked/${c.id}.${ext}`);
      }
      rows.push({ cue: c, takes, baked });
    }
    const html = renderReviewPage(rows, statuses);
    await writeFile(path.join(REPO_ROOT, "audio", "AUDIO_REVIEW.html"), html);
    console.log("Wrote audio/AUDIO_REVIEW.html — open via the dev server: http://localhost:8080/audio/AUDIO_REVIEW.html");
    return;
  }

  const cue = cues.find((c) => c.id === cueId);
  if (!cue) {
    console.error(`Unknown cue '${cueId}'. Known cues:\n  ${cues.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  if (has("--status")) {
    const next = flag("--status");
    if (!["approved", "pending"].includes(next)) {
      console.error("--status expects 'approved' or 'pending'");
      process.exit(1);
    }
    statuses[cue.id] = { ...(statuses[cue.id] || {}), approved: next === "approved", at: new Date().toISOString() };
    await writeFile(STATUS_FILE, JSON.stringify(statuses, null, 2) + "\n");
    console.log(`[${cue.id}] marked ${next}.`);
    return;
  }

  const variants = Number(flag("--variants") ?? DEFAULT_VARIANTS);
  if (!Number.isFinite(variants) || variants < 1) {
    console.error("--variants expects a positive integer");
    process.exit(1);
  }
  const overrides = {};
  if (flag("--prompt")) overrides.prompt = flag("--prompt");
  if (flag("--duration")) overrides.duration = Number(flag("--duration"));
  if (flag("--sound-type")) overrides.soundType = flag("--sound-type");

  await generateCue(cue, variants, overrides);
}

main().catch((e) => {
  console.error("\nError:", e.message);
  process.exit(1);
});
