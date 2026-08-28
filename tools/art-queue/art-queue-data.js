// GENERATED FILE — do not edit by hand.
// Regenerate with:  npm run art:queue:gen
// Source of truth:  src/data/skins.js  (character registry the game loads).
// Classic script on purpose: loaded via <script src> so this page also works
// when opened straight from the filesystem (file://), where Chrome blocks ES
// module imports. Status flips to "done" when the file exists in assets/.

const STYLE_LOCK = "2.5D game prop illustration for a retro note-paper bomb puzzle, soft matte cartoony look, warm muted desaturated palette, clean soft shading, subtle darker rim on bottom-right, light from top-left. No neon, no photo-realism, no outlines-heavy cel shading. Single isolated object centered, no baked ground shadow, no background (transparent), no text, no watermark.";

const TEMPLATES = {
  "Payload": "[SUBJECT], 2.5D game prop illustration for a retro note-paper bomb puzzle, soft matte cartoony look, warm muted desaturated palette, clean soft shading, subtle darker rim on bottom-right, light from top-left. No neon, no photo-realism, no outlines-heavy cel shading. Single isolated object centered, no baked ground shadow, no background (transparent), no text, no watermark.. Show ONLY the bomb object, centered, filling most of the frame. Keep the exact same character design across all three states of this character.",
  "Igniter": "[SUBJECT], 2.5D game prop illustration for a retro note-paper bomb puzzle, soft matte cartoony look, warm muted desaturated palette, clean soft shading, subtle darker rim on bottom-right, light from top-left. No neon, no photo-realism, no outlines-heavy cel shading. Single isolated object centered, no baked ground shadow, no background (transparent), no text, no watermark.. Show ONLY the igniter object, centered, filling most of the frame. Keep the exact same character design across all three states of this igniter."
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
    "subject": "Bananabomb: chubby banana-shaped yellow bomb with a perky green top. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_banana_win",
    "file": "lvl1_banana_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Bananabomb",
    "groupNote": "Starter · always owned",
    "template": "Payload",
    "subject": "Bananabomb: chubby banana-shaped yellow bomb with a perky green top. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_banana_lose",
    "file": "lvl1_banana_fail.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Bananabomb",
    "groupNote": "Starter · always owned",
    "template": "Payload",
    "subject": "Bananabomb: chubby banana-shaped yellow bomb with a perky green top. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_melon_playing",
    "file": "skin_melon_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: round honeydew melon bomb with a pale green rind. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_melon_win",
    "file": "skin_melon_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: round honeydew melon bomb with a pale green rind. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_melon_lose",
    "file": "skin_melon_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Melo-Bomb",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Payload",
    "subject": "Melo-Bomb: round honeydew melon bomb with a pale green rind. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_tnt_playing",
    "file": "skin_tnt_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "TNT Trouble",
    "groupNote": "Unlocks at level 8",
    "template": "Payload",
    "subject": "TNT Trouble: dynamite-stick bomb, red body, gold caps, wooden plug. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_tnt_win",
    "file": "skin_tnt_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "TNT Trouble",
    "groupNote": "Unlocks at level 8",
    "template": "Payload",
    "subject": "TNT Trouble: dynamite-stick bomb, red body, gold caps, wooden plug. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_tnt_lose",
    "file": "skin_tnt_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "TNT Trouble",
    "groupNote": "Unlocks at level 8",
    "template": "Payload",
    "subject": "TNT Trouble: dynamite-stick bomb, red body, gold caps, wooden plug. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_apple_playing",
    "file": "skin_apple_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Apple of Discord",
    "groupNote": "Unlocks at level 12 · or watch an ad",
    "template": "Payload",
    "subject": "Apple of Discord: round red apple bomb, glossy skin, leaf on top. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_apple_win",
    "file": "skin_apple_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Apple of Discord",
    "groupNote": "Unlocks at level 12 · or watch an ad",
    "template": "Payload",
    "subject": "Apple of Discord: round red apple bomb, glossy skin, leaf on top. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_apple_lose",
    "file": "skin_apple_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Apple of Discord",
    "groupNote": "Unlocks at level 12 · or watch an ad",
    "template": "Payload",
    "subject": "Apple of Discord: round red apple bomb, glossy skin, leaf on top. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_cheese_playing",
    "file": "skin_cheese_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Cheese Bomb",
    "groupNote": "Unlocks at level 16",
    "template": "Payload",
    "subject": "Cheese Bomb: wedge of swiss cheese bomb, yellow with round holes. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_cheese_win",
    "file": "skin_cheese_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Cheese Bomb",
    "groupNote": "Unlocks at level 16",
    "template": "Payload",
    "subject": "Cheese Bomb: wedge of swiss cheese bomb, yellow with round holes. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_cheese_lose",
    "file": "skin_cheese_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Cheese Bomb",
    "groupNote": "Unlocks at level 16",
    "template": "Payload",
    "subject": "Cheese Bomb: wedge of swiss cheese bomb, yellow with round holes. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_coco_playing",
    "file": "skin_coco_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Coco-Nut",
    "groupNote": "Unlocks at level 20 · or watch an ad",
    "template": "Payload",
    "subject": "Coco-Nut: round hairy brown coconut bomb, tough shell. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_coco_win",
    "file": "skin_coco_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Coco-Nut",
    "groupNote": "Unlocks at level 20 · or watch an ad",
    "template": "Payload",
    "subject": "Coco-Nut: round hairy brown coconut bomb, tough shell. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_coco_lose",
    "file": "skin_coco_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Coco-Nut",
    "groupNote": "Unlocks at level 20 · or watch an ad",
    "template": "Payload",
    "subject": "Coco-Nut: round hairy brown coconut bomb, tough shell. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_egg_playing",
    "file": "skin_egg_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Eggsplosive",
    "groupNote": "Unlocks at level 24",
    "template": "Payload",
    "subject": "Eggsplosive: smooth white egg bomb, gently speckled. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_egg_win",
    "file": "skin_egg_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Eggsplosive",
    "groupNote": "Unlocks at level 24",
    "template": "Payload",
    "subject": "Eggsplosive: smooth white egg bomb, gently speckled. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_egg_lose",
    "file": "skin_egg_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Eggsplosive",
    "groupNote": "Unlocks at level 24",
    "template": "Payload",
    "subject": "Eggsplosive: smooth white egg bomb, gently speckled. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_pineapple_playing",
    "file": "skin_pineapple_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Pineapple Express",
    "groupNote": "Unlocks at level 28",
    "template": "Payload",
    "subject": "Pineapple Express: pineapple bomb, spiky golden skin, leafy green crown. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_pineapple_win",
    "file": "skin_pineapple_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Pineapple Express",
    "groupNote": "Unlocks at level 28",
    "template": "Payload",
    "subject": "Pineapple Express: pineapple bomb, spiky golden skin, leafy green crown. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_pineapple_lose",
    "file": "skin_pineapple_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Pineapple Express",
    "groupNote": "Unlocks at level 28",
    "template": "Payload",
    "subject": "Pineapple Express: pineapple bomb, spiky golden skin, leafy green crown. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_pumpkin_playing",
    "file": "skin_pumpkin_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Pumpkin Panic",
    "groupNote": "Unlocks at level 32",
    "template": "Payload",
    "subject": "Pumpkin Panic: round orange pumpkin bomb, ribbed, leafy stem. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_pumpkin_win",
    "file": "skin_pumpkin_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Pumpkin Panic",
    "groupNote": "Unlocks at level 32",
    "template": "Payload",
    "subject": "Pumpkin Panic: round orange pumpkin bomb, ribbed, leafy stem. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_pumpkin_lose",
    "file": "skin_pumpkin_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Pumpkin Panic",
    "groupNote": "Unlocks at level 32",
    "template": "Payload",
    "subject": "Pumpkin Panic: round orange pumpkin bomb, ribbed, leafy stem. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_star_playing",
    "file": "skin_star_playing.png",
    "role": "playing",
    "cat": "bomb",
    "group": "Super Star",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Payload",
    "subject": "Super Star: five-pointed star-shaped golden bomb with a happy face. PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed."
  },
  {
    "id": "skin_star_win",
    "file": "skin_star_win.png",
    "role": "win",
    "cat": "bomb",
    "group": "Super Star",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Payload",
    "subject": "Super Star: five-pointed star-shaped golden bomb with a happy face. WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved."
  },
  {
    "id": "skin_star_lose",
    "file": "skin_star_lose.png",
    "role": "lose",
    "cat": "bomb",
    "group": "Super Star",
    "groupNote": "Unlocks at level 36 · or watch an ad",
    "template": "Payload",
    "subject": "Super Star: five-pointed star-shaped golden bomb with a happy face. FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke."
  },
  {
    "id": "skin_matchstick_idle",
    "file": "lvl1_matchstick_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. IDLE state: dormant igniter lying still, blank calm eyes."
  },
  {
    "id": "skin_matchstick_ignition",
    "file": "lvl1_matchstick_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. IGNITION state: igniter burning bright, sparking, energetic eyes."
  },
  {
    "id": "skin_matchstick_dud",
    "file": "lvl1_matchstick_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Matchstick",
    "groupNote": "Starter · always owned",
    "template": "Igniter",
    "subject": "Matchstick: plain red-tipped wooden match. DUD state: snuffed out, small smoke wisp, droopy defeated eyes."
  },
  {
    "id": "skin_lighter_idle",
    "file": "skin_lighter_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. IDLE state: dormant igniter lying still, blank calm eyes."
  },
  {
    "id": "skin_lighter_ignition",
    "file": "skin_lighter_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. IGNITION state: igniter burning bright, sparking, energetic eyes."
  },
  {
    "id": "skin_lighter_dud",
    "file": "skin_lighter_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Lighter",
    "groupNote": "Unlocks at level 4 · or watch an ad",
    "template": "Igniter",
    "subject": "Lighter: retro metal pocket lighter with a thumb-wheel striker. DUD state: snuffed out, small smoke wisp, droopy defeated eyes."
  },
  {
    "id": "skin_bolt_idle",
    "file": "skin_bolt_idle.png",
    "role": "idle",
    "cat": "igniter",
    "group": "Lightning Bolt",
    "groupNote": "Unlocks at level 10 · or watch an ad",
    "template": "Igniter",
    "subject": "Lightning Bolt: zigzag yellow lightning bolt with a cartoon face. IDLE state: dormant igniter lying still, blank calm eyes."
  },
  {
    "id": "skin_bolt_ignition",
    "file": "skin_bolt_ignition.png",
    "role": "ignition",
    "cat": "igniter",
    "group": "Lightning Bolt",
    "groupNote": "Unlocks at level 10 · or watch an ad",
    "template": "Igniter",
    "subject": "Lightning Bolt: zigzag yellow lightning bolt with a cartoon face. IGNITION state: igniter burning bright, sparking, energetic eyes."
  },
  {
    "id": "skin_bolt_dud",
    "file": "skin_bolt_dud.png",
    "role": "dud",
    "cat": "igniter",
    "group": "Lightning Bolt",
    "groupNote": "Unlocks at level 10 · or watch an ad",
    "template": "Igniter",
    "subject": "Lightning Bolt: zigzag yellow lightning bolt with a cartoon face. DUD state: snuffed out, small smoke wisp, droopy defeated eyes."
  }
];
