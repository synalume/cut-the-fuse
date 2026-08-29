# Cut the Fuse — marketing asset pipeline

Generates all distribution thumbnails + web branding, mirroring the Big Fluff /
Wobble Run shelf-punch pipeline (MuAPI `nano-banana-pro` — Nano Banana — T2I).

## Pipeline

```
tools/gen-marketing/gen-covers.mjs     MuAPI T2I → masters (cert/thumbnails/masters)
tools/gen-marketing/derive-assets.py   PIL derivation → all portal sizes + icons + OG
```

1. **Generate masters** (5 images, MuAPI nano-banana-pro):

```bash
node tools/gen-marketing/gen-covers.mjs             # dry-run: print prompts + manifest
node tools/gen-marketing/gen-covers.mjs --generate  # submit to MuAPI, download masters
```

Masters land in `tools/gen-marketing/out/masters/`:
`shelf-punch-{16x9,1x1,5x7,9x16}.png` + `icon-hero.png`.
Per-ratio composition briefs live in the script (hero position, threat, safe margins).
5:7 is generated as 2:3 (MuAPI ratio whitelist) and center-cropped in derivation.

2. **Derive every size**:

```bash
python3 tools/gen-marketing/derive-assets.py
```

| Output | Size | Where |
|--------|------|-------|
| Playables 16:9 | 1280×720 | `cert/thumbnails/16x9-1280x720.png` |
| Playables hi-res | 1920×1080 | `cert/thumbnails/16x9-1920x1080.png` |
| Playables 1:1 | 720×720 | `cert/thumbnails/thumb-1x1.png` |
| Playables 5:7 | 720×1008 | `cert/thumbnails/thumb-5x7.png` |
| Playables 16:9 shelf | 1280×720 | `cert/thumbnails/thumb-16x9.png` |
| Portrait shelf | 1080×1920 | `cert/thumbnails/portrait-1080x1920.png` |
| LOCKED masters | 720–1920 | `cert/thumbnails/shelf-punch-*-LOCKED.png` |
| Playgama icon | 800×800 | `playgama/covers/800x800.png` |
| Playgama portrait | 1080×1920 | `playgama/covers/1080x1920.png` |
| Playgama landscape | 1920×1080 | `playgama/covers/1920x1080.png` |
| Web OG | 1200×630 | `og.png` + `locked-branding/og-LOCKED.png` |
| Icon hero / PWA | 1024² / 512² / 192² | `locked-branding/icon-*-LOCKED.png` + root |
| Apple touch | 180×180 | `apple-touch-icon.png` + LOCKED |
| Favicons | 48/32/16 + multi .ico | root + `locked-branding/favicon-*-LOCKED.*` |

**Rules (MUST, mirror Big Fluff / Wobble Run):**

- Shelf cards are **textless** — no logo, no title, no "Play", no score UI.
- The only asset with text is the web OG (`og.png`), composited with the game
  font (Luckiest Guy) by `derive-assets.py`.
- `locked-branding/` is brand-lock only — never packed into any distribution zip.

## Style lock

The style lock in `gen-covers.mjs` matches the in-game 2D art prompt used for the
game sprites: **1930s rubber-hose / Cuphead vintage cartoon, 2D vector mobile game
asset, thick black ink outlines, flat muted vintage colors, no shading / no 3D /
no realism / no complex details**. Hero is the game's cute yellow banana with a
red TNT dynamite bundle strapped with rope (pie-cut frightened eyes, sweat drops).
Threat is wooden matchsticks with orange sparks, matching the in-game wicks.

## API key

`MUAPI_KEY` — env var, `tools/gen-marketing/.env`, or
`/Users/frankzhou/Projects/synalume-workspace/synalume-marketing/.env`.

## Model / ratio notes

- Model: `nano-banana-pro` (Nano Banana, Google Gemini 3 Pro Image) via MuAPI.
- MuAPI `aspect_ratio` whitelist: `1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3, 5:4, 4:5, 21:9`.
  So the 5:7 shelf is a 2:3 master center-cropped to 720×1008.

## Status

- [x] 2026-08-29 — first LOCKED set generated (nano-banana-pro), all sizes derived
- [x] 2026-08-29 — v2 regen: banana redrawn to match the in-game art (TNT-strapped
      banana, pie-cut eyes, black-ink flat-vintage style); cache bust → `?v=ctf2`
- [ ] Portal pixel sizes confirmed if suite differs: _____ × _____
