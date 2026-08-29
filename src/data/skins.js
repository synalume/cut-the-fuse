// skins.js — character skin registry.
// Art is per-SKIN (not per-level), so 10 payload characters × 3 frames + 3
// igniter types × 3 frames covers every level. Files that don't exist yet fall
// back to the placeholder set at resolve time (placeholder-first workflow).
//
// `theme` is the visual description used by tools/art-queue to prompt Gemini.
// File names in `assets` are the exact save paths the game loads (resolveAssets).
//
// unlock rules:
//   null                   -> starter, always owned
//   { level: N }           -> free once the player reaches level N
//   { level: N, ad: true } -> free at level N, OR watch a rewarded ad to get it now

export const PAYLOAD_SKINS = [
    {
        id: "banana",
        name: "Bananabomb",
        blurb: "The classic",
        theme: "cute yellow banana with a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "lvl1_banana_panic.png", win: "lvl1_banana_win.png", lose: "lvl1_banana_fail.png" },
        unlock: null,
    },
    {
        id: "melon",
        name: "Melo-Bomb",
        blurb: "Sweet, but not sorry",
        theme: "cute round watermelon with a dark green striped rind and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_melon_playing.png", win: "skin_melon_win.png", lose: "skin_melon_lose.png" },
        unlock: { level: 4, ad: true },
    },
    {
        id: "tnt",
        name: "TNT Trouble",
        blurb: "Old reliable",
        theme: "chubby red TNT dynamite stick with gold caps and a wooden plug, an extra bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_tnt_playing.png", win: "skin_tnt_win.png", lose: "skin_tnt_lose.png" },
        unlock: { level: 8 },
    },
    {
        id: "apple",
        name: "Apple of Discord",
        blurb: "An explosive idea",
        theme: "cute glossy red apple with a small leaf on top and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_apple_playing.png", win: "skin_apple_win.png", lose: "skin_apple_lose.png" },
        unlock: { level: 12, ad: true },
    },
    {
        id: "cheese",
        name: "Cheese Bomb",
        blurb: "Grate expectations",
        theme: "cute wedge of swiss cheese with round holes and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_cheese_playing.png", win: "skin_cheese_win.png", lose: "skin_cheese_lose.png" },
        unlock: { level: 16 },
    },
    {
        id: "coco",
        name: "Coco-Nut",
        blurb: "Kernel of truth",
        theme: "cute round hairy brown coconut and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_coco_playing.png", win: "skin_coco_win.png", lose: "skin_coco_lose.png" },
        unlock: { level: 20, ad: true },
    },
    {
        id: "egg",
        name: "Eggsplosive",
        blurb: "Hard-boiled",
        theme: "cute smooth white egg, gently speckled, with a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_egg_playing.png", win: "skin_egg_win.png", lose: "skin_egg_lose.png" },
        unlock: { level: 24 },
    },
    {
        id: "pineapple",
        name: "Pineapple Express",
        blurb: "Not so sweet",
        theme: "cute golden pineapple with a leafy green crown and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_pineapple_playing.png", win: "skin_pineapple_win.png", lose: "skin_pineapple_lose.png" },
        unlock: { level: 28 },
    },
    {
        id: "pumpkin",
        name: "Pumpkin Panic",
        blurb: "Carved and ready",
        theme: "cute round orange pumpkin with a leafy stem and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_pumpkin_playing.png", win: "skin_pumpkin_win.png", lose: "skin_pumpkin_lose.png" },
        unlock: { level: 32 },
    },
    {
        id: "star",
        name: "Super Star",
        blurb: "A star is born (to explode)",
        theme: "cute five-pointed golden star with a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_star_playing.png", win: "skin_star_win.png", lose: "skin_star_lose.png" },
        unlock: { level: 36, ad: true },
    },
];

export const IGNITER_TYPES = [
    {
        id: "matchstick",
        name: "Matchstick",
        blurb: "The classic",
        theme: "plain red-tipped wooden match",
        assets: { idle: "lvl1_matchstick_idle.png", ignition: "lvl1_matchstick_ignition.png", dud: "lvl1_matchstick_dud.png" },
        unlock: null,
    },
    {
        id: "lighter",
        name: "Lighter",
        blurb: "Flick and go",
        theme: "retro metal pocket lighter with a thumb-wheel striker",
        assets: { idle: "skin_lighter_idle.png", ignition: "skin_lighter_ignition.png", dud: "skin_lighter_dud.png" },
        unlock: { level: 4, ad: true },
    },
    {
        id: "bolt",
        name: "Lightning Bolt",
        blurb: "Strikes twice",
        theme: "zigzag yellow lightning bolt with a cartoon face",
        assets: { idle: "skin_bolt_idle.png", ignition: "skin_bolt_ignition.png", dud: "skin_bolt_dud.png" },
        unlock: { level: 10, ad: true },
    },
];

export function findPayloadSkin(id) {
    return PAYLOAD_SKINS.find((s) => s.id === id) || PAYLOAD_SKINS[0];
}

export function findIgniterType(id) {
    return IGNITER_TYPES.find((s) => s.id === id) || IGNITER_TYPES[0];
}

/** A skin is "owned" if it's a starter, already unlocked, or its progression
 *  threshold has been reached (rewards unlock the moment the player gets there). */
export function isSkinOwned(item, reachedLevel, unlocked) {
    if (!item.unlock) return true;
    if (unlocked) return true;
    return reachedLevel >= item.unlock.level;
}
