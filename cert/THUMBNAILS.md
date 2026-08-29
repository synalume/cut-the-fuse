# Cut the Fuse — Playables thumbnails

Upload alongside the zip on the Playables / MC Play console.

| File | Size | Where |
|------|------|-------|
| `thumbnails/16x9-1280x720.png` | 1280×720 | Playables thumbnail |
| `thumbnails/16x9-1920x1080.png` | 1920×1080 | High-res thumbnail |
| `thumbnails/portrait-1080x1920.png` | 1080×1920 | Portrait shelf |

Also derived (same art family, `tools/gen-marketing/`): `thumb-{1x1,5x7,16x9}.png`
and `shelf-punch-{1x1,5x7,16x9,9x16}-LOCKED.png` masters.

**Rule (MUST):** no branding, logos, or text on shelf cards — textless key art only.
The web OG (`og.png`, 1200×630) is the only asset that carries the title.

## Composition brief (locked shelf-punch)

1. **Hero:** the game's cute yellow banana with a bundle of red TNT strapped with
   rope, sweating nervously, wide frightened pie-cut eyes, small open mouth,
   black-ink flat-vintage style (same prompt family as the in-game sprite art).
2. **Threat:** 2–3 long wooden matchsticks with bright orange sparks + amber
   live-wire trails racing toward the banana.
3. **Ground:** aged off-white vintage note-paper desk, faint pencil-drawn fuse lines.
4. **One idea:** a spark is burning down the fuse toward the bomb — snip in time.
5. **Safe margins:** bomb, sparks, and fuse heads stay fully inside the frame.

## Source art

Generated via `tools/gen-marketing/gen-covers.mjs` (MuAPI `nano-banana-pro`) →
derived by `tools/gen-marketing/derive-assets.py`. See `tools/gen-marketing/README.md`.

## Status

- [x] **Shelf-punch LOCKED v2 (nano-banana-pro, 2026-08-29)** → `shelf-punch-*-LOCKED.png`
      — v2 regen matches the in-game banana art (TNT-strapped banana, pie-cut eyes)
- [x] **Playgama covers** → `playgama/covers/{800x800,1080x1920,1920x1080}.png`
- [x] **Web OG LOCKED** → `locked-branding/og-LOCKED.png` / root `og.png` — live `?v=ctf2`
- [x] **Favicon + Apple/PWA LOCKED** → `locked-branding/` — live `?v=ctf2`
- [ ] Portal pixel sizes confirmed if suite differs: _____ × _____
