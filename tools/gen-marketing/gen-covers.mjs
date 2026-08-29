#!/usr/bin/env node
/**
 * Cut the Fuse — marketing covers via MuAPI (Nano Banana).
 *
 * Mirrors the Big Fluff / Wobble Run shelf-punch pipeline:
 *   MuAPI T2I (nano-banana-pro) → per-ratio masters → derive-assets.py
 *
 * API key: $MUAPI_KEY, or tools/gen-marketing/.env, or
 *   /Users/frankzhou/Projects/synalume-workspace/synalume-marketing/.env
 *
 * Usage:
 *   node tools/gen-marketing/gen-covers.mjs            # dry-run: print prompts + manifest
 *   node tools/gen-marketing/gen-covers.mjs --generate  # submit to MuAPI, download masters
 *   node tools/gen-marketing/gen-covers.mjs --only=16x9 --generate
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const MUAPI_BASE = "https://api.muapi.ai/api/v1";
const MODEL = "nano-banana-pro"; // Google Gemini 3 Pro Image — "Nano Banana" via MuAPI
const OUT_DIR = join(process.cwd(), "tools/gen-marketing/out/masters");

/* ----------------------------- API key ----------------------------- */
function loadApiKey() {
  if (process.env.MUAPI_KEY) return process.env.MUAPI_KEY.trim();
  const candidates = [
    join(process.cwd(), "tools/gen-marketing/.env"),
    "/Users/frankzhou/Projects/synalume-workspace/synalume-marketing/.env",
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const m = readFileSync(p, "utf8").match(/^MUAPI_KEY=(.+)$/m);
      if (m) return m[1].trim();
    } catch {
      /* keep scanning */
    }
  }
  throw new Error("MUAPI_KEY not found. Set it in the environment or tools/gen-marketing/.env");
}

/* ------------------------- MuAPI client -------------------------
   Mirrors synalume-marketing/src/generator/muapi/client.ts + t2i.ts */
async function muapiPostJson(apiKey, path, body) {
  const res = await fetch(`${MUAPI_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MuAPI POST ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const requestId = data.request_id ?? data.id;
  if (!requestId) throw new Error(`MuAPI POST ${path} returned no request_id.`);
  return { requestId: String(requestId), raw: data };
}

async function muapiPoll(apiKey, requestId, { timeoutMs = 600_000, intervalMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MUAPI_BASE}/predictions/${encodeURIComponent(requestId)}/result`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MuAPI poll failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const result = await res.json();
    const status = (result.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded") return result;
    if (status === "failed" || status === "error") {
      throw new Error(result.error ?? `MuAPI job ${requestId} failed.`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`MuAPI job ${requestId} timed out after ${timeoutMs}ms.`);
}

function extractImageUrl(result) {
  if (Array.isArray(result.outputs)) {
    for (const item of result.outputs) {
      if (typeof item === "string" && item.startsWith("http")) return item;
      if (item && typeof item === "object") {
        const o = item;
        if (typeof o.url === "string") return o.url;
        if (typeof o.image_url === "string") return o.image_url;
      }
    }
  }
  const output = result.output;
  if (typeof output === "string" && output.startsWith("http")) return output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const o = output;
    for (const key of ["url", "image_url", "output"]) {
      if (typeof o[key] === "string" && o[key].startsWith("http")) return o[key];
    }
  }
  throw new Error("MuAPI result did not contain an image URL.");
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ----------------------------- Prompts -----------------------------
   Mirror the wobble-run / big-fluff shelf-punch composition briefs.
   Style lock is the game's 1930s rubber-hose cartoon look. */
const STYLE_LOCK =
  "1930s rubber-hose cartoon game key art, Fleischer Studios animation cel style, " +
  "thick hand-inked outline in warm dark brown #2B1F14, flat vintage cel colors with high saturation, " +
  "clean soft shading, light from top-left, subtle darker rim on bottom-right, " +
  "aged off-white vintage note-paper desk as the ground with faint pencil-drawn fuse sketch lines. " +
  "No neon, no photo-realism, no gradients, no text, no letters, no logo, no watermark, no score UI, no UI chrome.";

const HERO =
  "the hero: a chubby banana-shaped yellow cartoon bomb (Bananabomb) with a perky green top, " +
  "wide worried panicked eyes with pupils, sweat drops, puffed cheeks, and a short lit fuse on top " +
  "with one bright orange spark, glossy subtle shading, thick warm dark-brown ink outline";

const THREAT =
  "two or three long dark-brown braided fuses snaking across the frame, each with a glowing bright orange " +
  "spark racing along it toward the bomb, thin smoke wisps trailing, motion energy";

const ONE_IDEA =
  "one clear idea: a spark is burning down the fuse toward the bomb and the player must snip it in time.";

function promptFor(key) {
  switch (key) {
    case "16x9":
      return [
        `Wide horizontal 16:9 shelf card. ${HERO} positioned right-of-center filling about 48-55% of the frame, facing the incoming fuses.`,
        `${THREAT} sweeping in from the left edge and top-left corner.`,
        `Composition: wide chase read — bomb right, fuses left, extra dead space on the left is fine as long as the center is strong.`,
        ONE_IDEA,
        STYLE_LOCK + ".",
        "Safe margins: bomb, sparks, and fuse heads stay fully inside the frame; nothing clipped at the edges.",
      ].join(" ");
    case "1x1":
      return [
        `Square 1:1 game icon card. ${HERO} positioned left-of-center filling about 50-58% of the frame, facing the incoming fuses.`,
        `${THREAT} sweeping in from the right edge and top-right corner.`,
        "Composition: the bomb's silhouette must read at ~120px wide; strong center contrast on the sparks.",
        ONE_IDEA,
        STYLE_LOCK + ".",
        "Safe margins: bomb, sparks, and fuse heads stay fully inside the frame; nothing clipped at the edges.",
      ].join(" ");
    case "5x7":
      return [
        `Tall vertical 5:7 shelf card. ${HERO} positioned in the lower third filling about 45-52% of the frame, looking up at the incoming fuses.`,
        `${THREAT} dropping from the top edge and top corners toward the bomb.`,
        "Composition: tall shelf chase — bomb low, fuses high, strong vertical energy.",
        ONE_IDEA,
        STYLE_LOCK + ".",
        "Safe margins: bomb, sparks, and fuse heads stay fully inside the frame; nothing clipped at the edges.",
      ].join(" ");
    case "9x16":
      return [
        `Full portrait 9:16. ${HERO} positioned in the lower third filling about 45-52% of the frame, looking up.`,
        `${THREAT} snaking down from the top of the frame toward the bomb, with bright sparks racing along them.`,
        "Composition: tall portrait chase — bomb low, long vertical fuses, strong depth.",
        ONE_IDEA,
        STYLE_LOCK + ".",
        "Safe margins: bomb, sparks, and fuse heads stay fully inside the frame; nothing clipped at the edges.",
      ].join(" ");
    case "icon":
      return [
        "Square 1:1 app icon, single isolated object centered: a chubby banana-shaped yellow cartoon bomb (Bananabomb) with a perky green top, wide worried panicked eyes, sweat drops, puffed cheeks, and a short lit fuse on top with one bright orange spark.",
        "1930s rubber-hose cartoon style, Fleischer Studios animation cel, thick hand-inked outline in warm dark brown #2B1F14, flat vintage cel colors, clean soft shading, light from top-left.",
        "The bomb fills about 80% of the frame, centered, floating with a soft drop shadow only.",
        "Solid warm cream #F6ECD1 background, no desk, no fuses, no ground lines, no text, no letters, no logo, no watermark.",
      ].join(" ");
    default:
      throw new Error(`Unknown key ${key}`);
  }
}

const ASPECT = { "16x9": "16:9", "1x1": "1:1", "5x7": "2:3", "9x16": "9:16", icon: "1:1" };
// NOTE: MuAPI nano-banana-pro accepts only 1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3, 5:4, 4:5, 21:9.
// The 5:7 shelf (720×1008) is derived by center-cropping the 2:3 master in derive-assets.py.
const FILES = {
  "16x9": "shelf-punch-16x9.png",
  "1x1": "shelf-punch-1x1.png",
  "5x7": "shelf-punch-5x7.png",
  "9x16": "shelf-punch-9x16.png",
  icon: "icon-hero.png",
};

/* ----------------------------- main ----------------------------- */
const args = process.argv.slice(2);
const generate = args.includes("--generate");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const keys = only ? only.split(",") : Object.keys(FILES);

const apiKey = generate ? loadApiKey() : null;
await mkdir(OUT_DIR, { recursive: true });

console.log(`[gen-covers] model=${MODEL} mode=${generate ? "GENERATE" : "DRY-RUN"}`);
const manifest = [];

for (const key of keys) {
  if (!FILES[key]) throw new Error(`Unknown key "${key}"`);
  const prompt = promptFor(key);
  const destPath = join(OUT_DIR, FILES[key]);
  manifest.push({ key, aspect: ASPECT[key], file: FILES[key], prompt });
  await writeFile(join(OUT_DIR, `${key}.prompt.txt`), prompt, "utf8");
  console.log(`\n--- ${key} (${ASPECT[key]}) → ${FILES[key]} ---`);
  console.log(prompt.slice(0, 240) + (prompt.length > 240 ? "…" : ""));

  if (!generate) continue;

  console.log(`[gen-covers] submitting ${key}…`);
  const { requestId } = await muapiPostJson(apiKey, MODEL, {
    prompt,
    aspect_ratio: ASPECT[key],
    num_images: 1,
    seed: seedForKey(key),
  });
  console.log(`[gen-covers] ${key} request_id=${requestId} (polling…)`);
  const result = await muapiPoll(apiKey, requestId, {
    timeoutMs: Number(process.env.MUAPI_POLL_TIMEOUT_MS ?? 900_000),
  });
  const imageUrl = extractImageUrl(result);
  await downloadToFile(imageUrl, destPath);
  console.log(`[gen-covers] ${key} saved → ${destPath}`);
}

await writeFile(
  join(OUT_DIR, "manifest.json"),
  JSON.stringify({ model: MODEL, runId: new Date().toISOString(), manifest }, null, 2)
);

if (!generate) {
  console.log("\n[gen-covers] Dry-run complete. Next:");
  console.log("  node tools/gen-marketing/gen-covers.mjs --generate");
  console.log("  python3 tools/gen-marketing/derive-assets.py");
} else {
  console.log("\n[gen-covers] Masters ready. Next:");
  console.log("  python3 tools/gen-marketing/derive-assets.py");
}

/* Deterministic seed so re-runs give stable art while only= re-generates don't diverge. */
function seedForKey(key) {
  let h = 2166136261;
  for (const c of key) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}
