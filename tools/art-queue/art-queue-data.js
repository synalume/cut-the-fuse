// Cut the Fuse art queue — source of truth for the Gemini image swap.
// Workflow: copy a subject (or full prompt) -> paste into Gemini (Nano Banana)
// -> cut out in Canva / remove background -> save as assets/<file>.
// One row per file; 360 files = 60 levels x (3 bomb states + 3 matchstick states).
// The game auto-picks these up: lvl{N}_bomb_{panic,win,fail}.png and
// lvl{N}_matchstick_{idle,ignition,dud}.png (see LevelManager.resolveAssets).

const STYLE_LOCK =
  "2.5D game prop illustration for a retro note-paper bomb puzzle, soft matte cartoony look, warm muted desaturated palette, clean soft shading, subtle darker rim on bottom-right, light from top-left. No neon, no photo-realism, no outlines-heavy cel shading. Single isolated object centered, no baked ground shadow, no background (transparent), no text, no watermark.";

const TEMPLATES = {
  Bomb: `[SUBJECT], ${STYLE_LOCK}. Show ONLY the bomb object, centered, filling most of the frame. Keep the exact same character design across the three bomb files for this level.`,
  Matchstick: `[SUBJECT], ${STYLE_LOCK}. Show ONLY the matchstick object, centered, filling most of the frame. Keep the exact same character design across the three matchstick files for this level.`,
};

// Per-level bomb + matchstick themes (60 levels, placeholder-first).
const THEMES = [
  { bomb: "round classic black powder bomb, red fuse cap", matchstick: "plain red-tipped wooden match" },
  { bomb: "chubby banana-shaped yellow bomb, perky green top", matchstick: "banana-scented yellow match" },
  { bomb: "squat gray cannonball bomb with a round face", matchstick: "thick ship-cannon match" },
  { bomb: "round orange pumpkin bomb with a leafy stem", matchstick: "harvest-orange match" },
  { bomb: "blue round bomb with stars painted on it", matchstick: "blue-capped matchstick" },
  { bomb: "striped candy-cane bomb, white and red", matchstick: "peppermint-striped match" },
  { bomb: "dome-shaped brown chocolate bomb", matchstick: "chocolate-brown match" },
  { bomb: "round green lime bomb with a warty rind", matchstick: "lime-green match" },
  { bomb: "tiny black bomb with oversized panicked eyes", matchstick: "tiny matchstick, big head" },
  { bomb: "round watermelon bomb, dark rind, bright pink inside", matchstick: "watermelon-pink match" },
  { bomb: "fluffy cotton-ball bomb, pale cream", matchstick: "soft cream match" },
  { bomb: "round cherry bomb, glossy red, leaf on top", matchstick: "cherry-red match" },
  { bomb: "squat brass bell bomb, old polished metal", matchstick: "brass-and-black match" },
  { bomb: "round grape bomb, deep purple, frosty bloom", matchstick: "grape-purple match" },
  { bomb: "pinecone-shaped brown bomb with woody scales", matchstick: "pine-brown match" },
  { bomb: "round peach bomb, fuzzy orange-pink", matchstick: "peach-blush match" },
  { bomb: "egg-shaped white bomb, smooth shell", matchstick: "eggshell-white match" },
  { bomb: "round coal bomb, matte black, rough chunks", matchstick: "coal-black match" },
  { bomb: "strawberry-shaped red bomb with seeds", matchstick: "strawberry-red match" },
  { bomb: "round coconut bomb, hairy brown shell", matchstick: "coconut-tan match" },
  { bomb: "barrel-shaped wooden bomb with iron bands", matchstick: "tavern-oak match" },
  { bomb: "round avocado bomb, dark green skin", matchstick: "avocado-green match" },
  { bomb: "moon-shaped pale bomb with a sleepy face", matchstick: "moon-silver match" },
  { bomb: "round tomato bomb, bright red, leafy crown", matchstick: "tomato-red match" },
  { bomb: "icy blue snowball bomb, crystalline shine", matchstick: "ice-blue match" },
  { bomb: "round peanut bomb, tan shell, peanut face", matchstick: "peanut-tan match" },
  { bomb: "sun-shaped golden bomb with little rays", matchstick: "sun-gold match" },
  { bomb: "round onion bomb, papery brown layers", matchstick: "onion-gold match" },
  { bomb: "plump purple eggplant bomb, glossy", matchstick: "eggplant-purple match" },
  { bomb: "round marble bomb, white with grey veins", matchstick: "marble-grey match" },
  { bomb: "square gift-box bomb with a ribbon", matchstick: "festive striped match" },
  { bomb: "round beet bomb, deep magenta, leafy top", matchstick: "beet-magenta match" },
  { bomb: "acorn-shaped bomb, brown cap over tan shell", matchstick: "acorn-brown match" },
  { bomb: "round kiwi bomb, fuzzy brown skin", matchstick: "kiwi-green match" },
  { bomb: "crown-shaped golden bomb, regal face", matchstick: "royal crimson match" },
  { bomb: "round blueberry bomb, dusty blue, tiny crown", matchstick: "blueberry-blue match" },
  { bomb: "pearl-shaped iridescent bomb, soft sheen", matchstick: "pearl-white match" },
  { bomb: "round turnip bomb, white body, purple top", matchstick: "turnip-white match" },
  { bomb: "honey-drum bomb, warm amber with hex bumps", matchstick: "honey-gold match" },
  { bomb: "round fig bomb, deep purple-brown, teardrop", matchstick: "fig-purple match" },
  { bomb: "boulder bomb, mossy grey rock", matchstick: "rock-grey match" },
  { bomb: "round lemon bomb, bright yellow, waxy skin", matchstick: "lemon-yellow match" },
  { bomb: "tiny dynamite-stick bomb, red body", matchstick: "dynamite-red match" },
  { bomb: "round mandarin bomb, orange, dimpled peel", matchstick: "mandarin-orange match" },
  { bomb: "star-shaped yellow bomb, happy face", matchstick: "star-gold match" },
  { bomb: "round olive bomb, green-gold, firm skin", matchstick: "olive-green match" },
  { bomb: "chestnut bomb, glossy brown, flat belly", matchstick: "chestnut-brown match" },
  { bomb: "round plum bomb, dark purple bloom", matchstick: "plum-purple match" },
  { bomb: "teapot-shaped ceramic bomb, blue and white", matchstick: "porcelain-blue match" },
  { bomb: "round radish bomb, red with white tip", matchstick: "radish-red match" },
  { bomb: "honeycomb bomb, pale amber hexagons", matchstick: "wax-amber match" },
  { bomb: "round lime-green apple bomb, leaf", matchstick: "apple-green match" },
  { bomb: "brick-shaped red bomb, mortar lines", matchstick: "brick-red match" },
  { bomb: "round kumquat bomb, tiny orange", matchstick: "kumquat-orange match" },
  { bomb: "snowman bomb, white body, coal smile", matchstick: "carrot-orange match" },
  { bomb: "round fig-roll bomb, tan swirl", matchstick: "swirl-tan match" },
  { bomb: "golden treasure-chest bomb, studded", matchstick: "chest-gold match" },
  { bomb: "round blackberry bomb, dark bumpy", matchstick: "blackberry-dark match" },
  { bomb: "crystal bomb, faceted pale quartz", matchstick: "crystal-clear match" },
  { bomb: "hero round bomb, patriotic red, white, blue", matchstick: "hero-white match" },
];

const BOMB_STATES = {
  panic: { fileSuffix: "panic", prompt: "PANIC state: fuse lit with a live spark, wide worried eyes, sweat drops, cheeks puffed" },
  win: { fileSuffix: "win", prompt: "WIN state: fuse extinguished, relaxed happy eyes, soft smile, relieved" },
  fail: { fileSuffix: "fail", prompt: "FAIL state: mid-explosion, cracked sooty shell, dizzy spiral eyes, smoke" },
};

const MATCH_STATES = {
  idle: { fileSuffix: "idle", prompt: "IDLE state: dormant matchstick lying still, blank calm eyes" },
  ignition: { fileSuffix: "ignition", prompt: "IGNITION state: match head burning bright, sparking, energetic eyes" },
  dud: { fileSuffix: "dud", prompt: "DUD state: snuffed out, small smoke wisp, droopy defeated eyes" },
};

const ITEMS = [];
for (let n = 1; n <= 60; n++) {
  const act = Math.ceil(n / 20);
  const theme = THEMES[n - 1];
  for (const [state, s] of Object.entries(BOMB_STATES)) {
    ITEMS.push({
      id: `lvl${n}_bomb_${state}`,
      file: `lvl${n}_bomb_${s.fileSuffix}.png`,
      act,
      type: "bomb",
      template: "Bomb",
      subject: `Level ${n} bomb: ${theme.bomb}. ${s.prompt}.`,
    });
  }
  for (const [state, s] of Object.entries(MATCH_STATES)) {
    ITEMS.push({
      id: `lvl${n}_match_${state}`,
      file: `lvl${n}_matchstick_${s.fileSuffix}.png`,
      act,
      type: "matchstick",
      template: "Matchstick",
      subject: `Level ${n} matchstick: ${theme.matchstick}. ${s.prompt}.`,
    });
  }
}
