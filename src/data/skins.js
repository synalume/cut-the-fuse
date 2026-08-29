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
        id: "duck",
        name: "Duck and Cover",
        blurb: "Bath time just got dangerous.",
        theme: "cute yellow rubber duck with an orange bill and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_duck_playing.png", win: "skin_duck_win.png", lose: "skin_duck_lose.png" },
        unlock: { level: 8 },
    },
    {
        id: "clock",
        name: "Wake-Up Call",
        blurb: "Time's up... for you.",
        theme: "cute round retro alarm clock with two bells on top and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_clock_playing.png", win: "skin_clock_win.png", lose: "skin_clock_lose.png" },
        unlock: { level: 12, ad: true },
    },
    {
        id: "bulb",
        name: "Bright Idea",
        blurb: "A brilliant idea. Too brilliant.",
        theme: "cute glowing lightbulb with a warm yellow glow and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_bulb_playing.png", win: "skin_bulb_win.png", lose: "skin_bulb_lose.png" },
        unlock: { level: 16 },
    },
    {
        id: "sock",
        name: "Dirty Bomb",
        blurb: "Not sure what's inside. Don't ask.",
        theme: "cute striped tube sock with a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_sock_playing.png", win: "skin_sock_win.png", lose: "skin_sock_lose.png" },
        unlock: { level: 20, ad: true },
    },
    {
        id: "piggy",
        name: "Piggy Boom",
        blurb: "Saving up for a big bang.",
        theme: "cute pink piggy bank with a coin slot on top and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_piggy_playing.png", win: "skin_piggy_win.png", lose: "skin_piggy_lose.png" },
        unlock: { level: 24 },
    },
    {
        id: "boot",
        name: "Sole Survivor",
        blurb: "Heel have to run.",
        theme: "cute worn leather boot with a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_boot_playing.png", win: "skin_boot_win.png", lose: "skin_boot_lose.png" },
        unlock: { level: 28 },
    },
    {
        id: "chili",
        name: "Hot Head",
        blurb: "Spicy. And a little sensitive.",
        theme: "cute fiery red chili pepper with a green stem and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_chili_playing.png", win: "skin_chili_win.png", lose: "skin_chili_lose.png" },
        unlock: { level: 32 },
    },
    {
        id: "tv",
        name: "Tube Trouble",
        blurb: "Now showing: disaster.",
        theme: "cute retro tube television with rabbit-ear antennas and a bundle of red TNT dynamite strapped to it with rope",
        assets: { playing: "skin_tv_playing.png", win: "skin_tv_win.png", lose: "skin_tv_lose.png" },
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
        // The lighter's art fills more of the shared 800×436 canvas than the
        // other igniters, so it reads oversized next to them in the armory.
        // Scale its preview slightly down (armory-only; in-game the ignition
        // frame's flame must stay glued to the fuse).
        artScale: 0.82,
        unlock: { level: 4, ad: true },
    },
    {
        id: "cigar",
        name: "Big Cigar",
        blurb: "The big smoke",
        theme: "chubby fat brown cigar with a gold paper band and a rounded ember tip",
        assets: { idle: "skin_cigar_idle.png", ignition: "skin_cigar_ignition.png", dud: "skin_cigar_dud.png" },
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
