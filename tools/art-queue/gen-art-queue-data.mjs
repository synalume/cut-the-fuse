// Regenerates tools/art-queue/art-queue-data.js from src/data/skins.js — the
// single source of truth for the character registry. The queue page loads the
// generated file as a CLASSIC script (no ES imports) so it also opens directly
// from the filesystem (file://), where Chrome blocks module scripts.
//
// Run:  node tools/art-queue/gen-art-queue-data.mjs   (or npm run art:queue:gen)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PAYLOAD_SKINS, IGNITER_TYPES } from "../../src/data/skins.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STYLE_LOCK =
  "1930s rubber hose animation style, Cuphead vintage cartoon aesthetic, 2D vector mobile game asset. " +
  "Thick black ink outlines, flat muted vintage colors, clean pure white background. " +
  "No shading, no 3D, no realism, no complex details, no neon, no gradients, no text, no watermark";

const TEMPLATES = {
  Payload: `[SUBJECT], ${STYLE_LOCK}. Show ONLY the bomb object, centered, filling most of the frame. The character is sweating nervously with wide, frightened pie-cut eyes. Keep the exact same character design across all three states of this character.`,
  Igniter: `[SUBJECT], ${STYLE_LOCK}. Show ONLY the igniter object, centered, filling most of the frame. Keep the exact same character design across all three states of this igniter.`,
};

const PAYLOAD_STATES = {
  playing: { role: "playing", prompt: "PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed" },
  win: { role: "win", prompt: "WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief" },
  lose: { role: "lose", prompt: "FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke" },
};

const IGNITER_STATES = {
  idle: { role: "idle", prompt: "IDLE state: dormant igniter lying still, blank calm pie-cut eyes" },
  ignition: { role: "ignition", prompt: "IGNITION state: igniter burning bright, sparking, wide energetic pie-cut eyes" },
  dud: { role: "dud", prompt: "DUD state: snuffed out, small smoke wisp, droopy defeated pie-cut eyes" },
};

const unlockLabel = (item) => {
  if (!item.unlock) return "Starter · always owned";
  return item.unlock.ad
    ? `Unlocks at level ${item.unlock.level} · or watch an ad`
    : `Unlocks at level ${item.unlock.level}`;
};

const ITEMS = [];

for (const skin of PAYLOAD_SKINS) {
  for (const [state, s] of Object.entries(PAYLOAD_STATES)) {
    ITEMS.push({
      id: `skin_${skin.id}_${state}`,
      file: skin.assets[state],
      role: s.role,
      cat: "bomb",
      group: skin.name,
      groupNote: unlockLabel(skin),
      template: "Payload",
      subject: `${skin.name}: ${skin.theme}. ${s.prompt}.`,
    });
  }
}

for (const ign of IGNITER_TYPES) {
  for (const [state, s] of Object.entries(IGNITER_STATES)) {
    ITEMS.push({
      id: `skin_${ign.id}_${state}`,
      file: ign.assets[state],
      role: s.role,
      cat: "igniter",
      group: ign.name,
      groupNote: unlockLabel(ign),
      template: "Igniter",
      subject: `${ign.name}: ${ign.theme}. ${s.prompt}.`,
    });
  }
}

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  npm run art:queue:gen
// Source of truth:  src/data/skins.js  (character registry the game loads).
// Classic script on purpose: loaded via <script src> so this page also works
// when opened straight from the filesystem (file://), where Chrome blocks ES
// module imports. Status flips to "done" when the file exists in assets/.

const STYLE_LOCK = ${JSON.stringify(STYLE_LOCK)};

const TEMPLATES = ${JSON.stringify(TEMPLATES, null, 2)};

const ITEMS = ${JSON.stringify(ITEMS, null, 2)};
`;

writeFileSync(join(__dirname, "art-queue-data.js"), out);
console.log(`Wrote tools/art-queue/art-queue-data.js (${ITEMS.length} rows)`);
