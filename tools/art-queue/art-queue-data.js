// GENERATED FILE — do not edit by hand.
// Regenerate with:  npm run art:queue:gen
// Sources of truth:  src/data/skins.js  (registry the game loads) +
//                    tools/art-queue/prompts.mjs  (art-direction text).
// Classic script on purpose: loaded via <script src> so this page also works
// when opened straight from the filesystem (file://), where Chrome blocks ES
// module imports. Status flips to "done" when the file exists in assets/.

const STYLE_LOCK = "1930s rubber hose animation style, Cuphead vintage cartoon aesthetic, 2D vector mobile game asset. Thick black ink outlines, flat muted vintage colors, clean pure white background. No shading, no 3D, no realism, no complex details, no neon, no gradients, no text, no watermark";

const TEMPLATES = {
  "Payload": "[SUBJECT], 1930s rubber hose animation style, Cuphead vintage cartoon aesthetic, 2D vector mobile game asset. Thick black ink outlines, flat muted vintage colors, clean pure white background. No shading, no 3D, no realism, no complex details, no neon, no gradients, no text, no watermark. Show ONLY the bomb object, centered, filling most of the frame. The character is sweating nervously with wide, frightened pie-cut eyes. Keep the exact same character design across all three states of this character.",
  "Igniter": "[SUBJECT], 1930s rubber hose animation style, Cuphead vintage cartoon aesthetic, 2D vector mobile game asset. Thick black ink outlines, flat muted vintage colors, clean pure white background. No shading, no 3D, no realism, no complex details, no neon, no gradients, no text, no watermark. Show ONLY the igniter object, centered, filling most of the frame. Keep the exact same character design across all three states of this igniter."
};

const ITEMS = [
  {
    "id": "skin_banana_playing",
    "file": "lvl1_banana_panic.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Bananabomb",
    "groupNote": "Starter · always owned",
    "template": "Payload",
    "subject": "Bananabomb: cute yellow banana with a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_banana_win",
    "file": "lvl1_banana_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Bananabomb",
    "groupNote": "Starter · always owned",
    "template": "Payload",
    "subject": "Bananabomb: cute yellow banana with a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_banana_lose",
    "file": "lvl1_banana_fail.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Bananabomb",
    "groupNote": "Starter · always owned",
    "template": "Payload",
    "subject": "Bananabomb: cute yellow banana with a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_melon_playing",
    "file": "skin_melon_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: cute round watermelon with a dark green striped rind and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_melon_win",
    "file": "skin_melon_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: cute round watermelon with a dark green striped rind and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_melon_lose",
    "file": "skin_melon_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: cute round watermelon with a dark green striped rind and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_duck_playing",
    "file": "skin_duck_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Duck and Cover",
    "groupNote": "Unlocks at level 25",
    "template": "Payload",
    "subject": "Duck and Cover: cute yellow rubber duck with an orange bill and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_duck_win",
    "file": "skin_duck_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Duck and Cover",
    "groupNote": "Unlocks at level 25",
    "template": "Payload",
    "subject": "Duck and Cover: cute yellow rubber duck with an orange bill and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_duck_lose",
    "file": "skin_duck_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Duck and Cover",
    "groupNote": "Unlocks at level 25",
    "template": "Payload",
    "subject": "Duck and Cover: cute yellow rubber duck with an orange bill and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_clock_playing",
    "file": "skin_clock_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Wake-Up Call",
    "groupNote": "Unlocks at level 46 · or watch an ad",
    "template": "Payload",
    "subject": "Wake-Up Call: cute round retro alarm clock with two bells on top and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_clock_win",
    "file": "skin_clock_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Wake-Up Call",
    "groupNote": "Unlocks at level 46 · or watch an ad",
    "template": "Payload",
    "subject": "Wake-Up Call: cute round retro alarm clock with two bells on top and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_clock_lose",
    "file": "skin_clock_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Wake-Up Call",
    "groupNote": "Unlocks at level 46 · or watch an ad",
    "template": "Payload",
    "subject": "Wake-Up Call: cute round retro alarm clock with two bells on top and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_bulb_playing",
    "file": "skin_bulb_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Bright Idea",
    "groupNote": "Unlocks at level 57",
    "template": "Payload",
    "subject": "Bright Idea: cute glowing lightbulb with a warm yellow glow and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_bulb_win",
    "file": "skin_bulb_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Bright Idea",
    "groupNote": "Unlocks at level 57",
    "template": "Payload",
    "subject": "Bright Idea: cute glowing lightbulb with a warm yellow glow and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_bulb_lose",
    "file": "skin_bulb_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Bright Idea",
    "groupNote": "Unlocks at level 57",
    "template": "Payload",
    "subject": "Bright Idea: cute glowing lightbulb with a warm yellow glow and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_sock_playing",
    "file": "skin_sock_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Dirty Bomb",
    "groupNote": "Unlocks at level 67 · or watch an ad",
    "template": "Payload",
    "subject": "Dirty Bomb: cute striped tube sock with a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_sock_win",
    "file": "skin_sock_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Dirty Bomb",
    "groupNote": "Unlocks at level 67 · or watch an ad",
    "template": "Payload",
    "subject": "Dirty Bomb: cute striped tube sock with a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_sock_lose",
    "file": "skin_sock_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Dirty Bomb",
    "groupNote": "Unlocks at level 67 · or watch an ad",
    "template": "Payload",
    "subject": "Dirty Bomb: cute striped tube sock with a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_piggy_playing",
    "file": "skin_piggy_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Piggy Boom",
    "groupNote": "Unlocks at level 78",
    "template": "Payload",
    "subject": "Piggy Boom: cute pink piggy bank with a coin slot on top and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_piggy_win",
    "file": "skin_piggy_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Piggy Boom",
    "groupNote": "Unlocks at level 78",
    "template": "Payload",
    "subject": "Piggy Boom: cute pink piggy bank with a coin slot on top and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_piggy_lose",
    "file": "skin_piggy_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Piggy Boom",
    "groupNote": "Unlocks at level 78",
    "template": "Payload",
    "subject": "Piggy Boom: cute pink piggy bank with a coin slot on top and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_boot_playing",
    "file": "skin_boot_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Sole Survivor",
    "groupNote": "Unlocks at level 89",
    "template": "Payload",
    "subject": "Sole Survivor: cute worn leather boot with a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_boot_win",
    "file": "skin_boot_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Sole Survivor",
    "groupNote": "Unlocks at level 89",
    "template": "Payload",
    "subject": "Sole Survivor: cute worn leather boot with a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_boot_lose",
    "file": "skin_boot_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Sole Survivor",
    "groupNote": "Unlocks at level 89",
    "template": "Payload",
    "subject": "Sole Survivor: cute worn leather boot with a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_chili_playing",
    "file": "skin_chili_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Hot Head",
    "groupNote": "Unlocks at level 99",
    "template": "Payload",
    "subject": "Hot Head: cute fiery red chili pepper with a green stem and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_chili_win",
    "file": "skin_chili_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Hot Head",
    "groupNote": "Unlocks at level 99",
    "template": "Payload",
    "subject": "Hot Head: cute fiery red chili pepper with a green stem and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_chili_lose",
    "file": "skin_chili_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Hot Head",
    "groupNote": "Unlocks at level 99",
    "template": "Payload",
    "subject": "Hot Head: cute fiery red chili pepper with a green stem and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_tv_playing",
    "file": "skin_tv_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Tube Trouble",
    "groupNote": "Unlocks at level 110 · or watch an ad",
    "template": "Payload",
    "subject": "Tube Trouble: cute retro tube television with rabbit-ear antennas and a bundle of red TNT dynamite strapped to it with rope. PANIC state: fuse lit with a live spark, sweating nervously, wide frightened pie-cut eyes, sweat drops flying, cheeks puffed."
  },
  {
    "id": "skin_tv_win",
    "file": "skin_tv_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Tube Trouble",
    "groupNote": "Unlocks at level 110 · or watch an ad",
    "template": "Payload",
    "subject": "Tube Trouble: cute retro tube television with rabbit-ear antennas and a bundle of red TNT dynamite strapped to it with rope. WIN state: fuse extinguished, relieved happy pie-cut eyes, soft smile, a breath of relief."
  },
  {
    "id": "skin_tv_lose",
    "file": "skin_tv_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Tube Trouble",
    "groupNote": "Unlocks at level 110 · or watch an ad",
    "template": "Payload",
    "subject": "Tube Trouble: cute retro tube television with rabbit-ear antennas and a bundle of red TNT dynamite strapped to it with rope. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral pie-cut eyes, smoke."
  },
  {
    "id": "skin_matchstick_idle",
    "file": "lvl1_matchstick_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. IDLE state: quiet sinister smirk, red head unlit."
  },
  {
    "id": "skin_matchstick_ignition",
    "file": "lvl1_matchstick_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. IGNITION state: evil wide-open laughing mouth, red head glowing bright yellow and orange with a fiery spark."
  },
  {
    "id": "skin_matchstick_dud",
    "file": "lvl1_matchstick_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. DUD state: frustrated and angry, crossed stick-figure arms, broken burnt-out black head."
  },
  {
    "id": "skin_lighter_idle",
    "file": "skin_lighter_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 14 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. IDLE state: quiet sinister smirk, flame out."
  },
  {
    "id": "skin_lighter_ignition",
    "file": "skin_lighter_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 14 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. IGNITION state: evil wide-open laughing mouth, flame burning bright yellow and orange with a fiery spark."
  },
  {
    "id": "skin_lighter_dud",
    "file": "skin_lighter_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 14 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. DUD state: frustrated and angry, crossed stick-figure arms, battered dud lighter with no flame."
  },
  {
    "id": "skin_cigar_idle",
    "file": "skin_cigar_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Big Cigar",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Igniter",
    "subject": "Big Cigar: chubby fat brown cigar with a gold paper band and a rounded ember tip. IDLE state: quiet sinister smirk, ember tip unlit."
  },
  {
    "id": "skin_cigar_ignition",
    "file": "skin_cigar_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Big Cigar",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Igniter",
    "subject": "Big Cigar: chubby fat brown cigar with a gold paper band and a rounded ember tip. IGNITION state: evil wide-open laughing mouth, ember tip glowing bright red-orange with a fiery spark."
  },
  {
    "id": "skin_cigar_dud",
    "file": "skin_cigar_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Big Cigar",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Igniter",
    "subject": "Big Cigar: chubby fat brown cigar with a gold paper band and a rounded ember tip. DUD state: frustrated and angry, crossed stick-figure arms, burnt-down stub with a black charred tip."
  }
];
