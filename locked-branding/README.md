# locked-branding

Brand-lock files (icons, favicons, OG images) that must **never** be packed into
any distribution zip (`dist/`, `playgama/`, `cert/` all assert this).

**Status: LOCKED (2026-08-29 v2, nano-banana-pro).** Shipping share / tab / home-screen
assets for `play.cutthefuse.com`. Same layout family as Big Fluff / Wobble Run.
v2 regenerated the banana to match the in-game art (TNT-strapped banana, pie-cut
eyes, black-ink flat-vintage style). Do not overwrite without an intentional
unlock + new `?v=` cache bust.

## Live (play.cutthefuse.com)

| Asset | Live file | Cache bust |
|-------|-----------|------------|
| Open Graph / share | `/og.png` | `?v=ctf2` |
| Favicons | `/favicon-{16,32,48}.png`, `/favicon.ico` | `?v=ctf2` |
| Apple home screen | `/apple-touch-icon.png` | `?v=ctf2` |
| PWA icons + manifest | `/icon-192.png`, `/icon-512.png`, `/site.webmanifest` | `?v=ctf2` |

## What's locked here

| File | Notes |
|------|--------|
| `og-LOCKED.png` | 1200×630 key art — title + tagline composited (Luckiest Guy) |
| `icon-hero-LOCKED.png` | 1024² banana bomb on cream card (icon source) |
| `icon-{192,512,1024}-LOCKED.png` | Home / PWA (from icon hero) |
| `apple-touch-icon-LOCKED.png` | 180² (from icon hero) |
| `favicon-{16,32,48}-LOCKED.png` | Transparent favicons (from icon hero) |
| `favicon-LOCKED.ico` | Multi-size ico (16/32/48) |

Shelf thumbs (textless) live in `cert/thumbnails/shelf-punch-*-LOCKED.png`.
Playgama exact pixels: `playgama/covers/`.

## Regenerate / restore from lock

```bash
cd tools/gen-marketing
node gen-covers.mjs --generate      # MuAPI nano-banana-pro
python3 derive-assets.py            # all sizes → cert/ playgama/ locked-branding/ root
cd ../..
# bump ?v=ctf2 → ?v=ctf3 in index.html + site.webmanifest, then ./deploy.sh
```
