// tools/art-queue/prompts.mjs — art-direction prompts for the character
// registry. Dev-only: this file never ships in a game or portal bundle.
// Keyed by skin/igniter id so the runtime registry (src/data/skins.js) stays
// clean of art-pipeline metadata. Source of truth for art-queue-data.js.

export const PAYLOAD_THEMES = {
  banana: "cute yellow banana with a bundle of red TNT dynamite strapped to it with rope",
  melon: "cute round watermelon with a dark green striped rind and a bundle of red TNT dynamite strapped to it with rope",
  duck: "cute yellow rubber duck with an orange bill and a bundle of red TNT dynamite strapped to it with rope",
  clock: "cute round retro alarm clock with two bells on top and a bundle of red TNT dynamite strapped to it with rope",
  bulb: "cute glowing lightbulb with a warm yellow glow and a bundle of red TNT dynamite strapped to it with rope",
  sock: "cute striped tube sock with a bundle of red TNT dynamite strapped to it with rope",
  piggy: "cute pink piggy bank with a coin slot on top and a bundle of red TNT dynamite strapped to it with rope",
  boot: "cute worn leather boot with a bundle of red TNT dynamite strapped to it with rope",
  chili: "cute fiery red chili pepper with a green stem and a bundle of red TNT dynamite strapped to it with rope",
  tv: "cute retro tube television with rabbit-ear antennas and a bundle of red TNT dynamite strapped to it with rope",
};

export const IGNITER_THEMES = {
  matchstick: "plain red-tipped wooden match",
  lighter: "retro metal pocket lighter with a thumb-wheel striker",
  cigar: "chubby fat brown cigar with a gold paper band and a rounded ember tip",
};
