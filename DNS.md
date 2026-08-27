# Cut the Fuse domains (mirror Big Fluff / Wobble Run)

| Host | Purpose | Target |
|------|---------|--------|
| `cutthefuse.com` (+ `www`) | Marketing (Lovable) | Lovable custom domain |
| `play.cutthefuse.com` | Game (Firebase Hosting) | Site `cut-the-fuse` → `cut-the-fuse.web.app` |

Same pattern as Big Fluff / Wobble Run: apex Lovable, `play.*` Firebase (`synalume-care`).

## Status

- [x] Firebase site `cut-the-fuse` created
- [x] Placeholder live: https://cut-the-fuse.web.app
- [ ] Custom domain `play.cutthefuse.com` registered in Firebase
- [ ] Lovable DNS: `play` CNAME → `cut-the-fuse.web.app` + ACME TXT
- [ ] Lovable marketing project + domain connected
- [ ] `play.cutthefuse.com` HTTPS active

## 1 · Play DNS (do this at Name.com / Lovable DNS panel)

Firebase currently sees a parking A record on `play.cutthefuse.com`. Replace it:

| Action | Host | Type | Value |
|--------|------|------|--------|
| **REMOVE** | `play` | A | (parking) |
| **ADD** | `play` | **CNAME** | `cut-the-fuse.web.app` |
| **ADD** | `_acme-challenge.play` | **TXT** | (from Firebase console) |

After DNS propagates, Firebase provisions SSL. Then https://play.cutthefuse.com/ serves the game.

Redeploy anytime:

```bash
cd cut-the-fuse && ./deploy.sh
```

## 2 · Marketing — Lovable (apex)

1. Create a Cut the Fuse marketing project in Lovable (same shape as Big Fluff landing).
2. Connect custom domain **`cutthefuse.com`** (+ `www` if offered).
3. Apply Lovable’s A/CNAME records at the registrar.
4. CTA → `https://play.cutthefuse.com/`.

Do **not** point the apex at Firebase if Lovable owns marketing — keep the split identical to Big Fluff / Wobble Run.
