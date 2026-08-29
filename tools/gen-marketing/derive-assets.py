#!/usr/bin/env python3
"""
Cut the Fuse — derive all marketing sizes from the MuAPI masters.

Mirrors the Big Fluff / Wobble Run packaging:
  masters (tools/gen-marketing/out/masters/*.png)
  → cert/thumbnails/ (Playables + LOCKED set)
  → playgama/covers/ (exact portal pixels)
  → locked-branding/ (LOCKED icons + favicons + OG)
  → repo root live copies (favicon-*, apple-touch-icon, icon-*, og.png)

Run after:  node tools/gen-marketing/gen-covers.mjs --generate
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
MASTERS = ROOT / "tools/gen-marketing/out/masters"
CERT = ROOT / "cert/thumbnails"
PLAYGAMA = ROOT / "playgama/covers"
LOCKED = ROOT / "locked-branding"

CREAM = (246, 236, 209, 255)  # #F6ECD1 — game card cream
INK = (43, 31, 20, 255)  # #2B1F14 — game ink outline


def crop_to_ratio(img: Image.Image, ratio_w: float, ratio_h: float) -> Image.Image:
    """Center-crop an image to the given aspect ratio."""
    w, h = img.size
    target = ratio_w / ratio_h
    cur = w / h
    if abs(cur - target) < 0.001:
        return img
    if cur > target:  # too wide — crop width
        new_w = int(h * target)
        x0 = (w - new_w) // 2
        return img.crop((x0, 0, x0 + new_w, h))
    new_h = int(w / target)
    y0 = (h - new_h) // 2
    return img.crop((0, y0, w, y0 + new_h))


def fit(img: Image.Image, w: int, h: int, cover: bool = True) -> Image.Image:
    """Resize to exactly w×h (cover = center-crop first)."""
    if cover:
        img = crop_to_ratio(img, w, h)
    return img.resize((w, h), Image.LANCZOS)


def load(name: str) -> Image.Image:
    p = MASTERS / name
    if not p.exists():
        sys.exit(f"error: missing master {p} — run gen-covers.mjs --generate first")
    return Image.open(p).convert("RGBA")


def save(img: Image.Image, path: Path, mode: str = "RGBA") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = img.convert(mode)
    img.save(path)


def og_with_text(base: Image.Image) -> Image.Image:
    """Composite the game title onto the 1200x630 OG card (wobble-run style)."""
    img = base.copy().convert("RGB")
    draw = ImageDraw.Draw(img)
    font = load_title_font()
    title = "CUT THE FUSE"
    tag = "ONE SNIP FROM DISASTER"
    w, h = img.size
    # big title centered, lower-left block with a drop shadow
    ts = int(h * 0.24)
    f_title = ImageFont.truetype(str(font), ts)
    bbox = draw.textbbox((0, 0), title, font=f_title)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx, ty = (w - tw) // 2, int(h * 0.08)
    shadow_off = max(3, int(ts * 0.06))
    draw.text((tx + shadow_off, ty + shadow_off), title, font=f_title, fill=INK)
    draw.text((tx, ty), title, font=f_title, fill=CREAM)
    # tagline
    ts2 = int(h * 0.07)
    f_tag = ImageFont.truetype(str(font), ts2)
    bbox2 = draw.textbbox((0, 0), tag, font=f_tag)
    tw2, th2 = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]
    tx2, ty2 = (w - tw2) // 2, ty + th + int(h * 0.05)
    draw.text((tx2 + max(2, shadow_off // 2), ty2 + max(2, shadow_off // 2)), tag, font=f_tag, fill=INK)
    draw.text((tx2, ty2), tag, font=f_tag, fill=(255, 205, 96, 255))
    return img


def load_title_font() -> Path:
    """Prefer the game's Luckiest Guy (woff2→ttf via fontTools), else a system bold."""
    ttf = ROOT / "tools/gen-marketing/.cache/luckiest-guy.ttf"
    if ttf.exists():
        return ttf
    woff = ROOT / "assets/fonts/luckiest-guy-latin.woff2"
    if woff.exists():
        from fontTools.ttLib import TTFont

        ttf.parent.mkdir(parents=True, exist_ok=True)
        TTFont(str(woff)).save(ttf)
        return ttf
    return Path("/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf")


def main() -> None:
    print("[derive] loading masters…")
    w16 = load("shelf-punch-16x9.png")
    w1 = load("shelf-punch-1x1.png")
    w57 = load("shelf-punch-5x7.png")
    w916 = load("shelf-punch-9x16.png")
    icon = load("icon-hero.png")

    # ---- Playables thumbnails (cert/THUMBNAILS.md names) ----
    print("[derive] Playables thumbnails…")
    save(fit(w16, 1280, 720), CERT / "16x9-1280x720.png")
    save(fit(w16, 1920, 1080), CERT / "16x9-1920x1080.png")
    save(fit(w916, 1080, 1920), CERT / "portrait-1080x1920.png")
    # wobble-style shelf set
    save(fit(w1, 720, 720), CERT / "thumb-1x1.png")
    save(fit(w57, 720, 1008), CERT / "thumb-5x7.png")
    save(fit(w16, 1280, 720), CERT / "thumb-16x9.png")
    # LOCKED masters
    save(fit(w1, 720, 720), CERT / "shelf-punch-1x1-LOCKED.png")
    save(fit(w57, 720, 1008), CERT / "shelf-punch-5x7-LOCKED.png")
    save(fit(w16, 1280, 720), CERT / "shelf-punch-16x9-LOCKED.png")
    save(fit(w916, 1080, 1920), CERT / "shelf-punch-9x16-LOCKED.png")

    # ---- Playgama exact covers ----
    print("[derive] Playgama covers…")
    save(fit(w1, 800, 800), PLAYGAMA / "800x800.png")
    save(fit(w916, 1080, 1920), PLAYGAMA / "1080x1920.png")
    save(fit(w16, 1920, 1080), PLAYGAMA / "1920x1080.png")

    # ---- OG / share (1200×630 with title) ----
    print("[derive] OG / share…")
    og = og_with_text(fit(w16, 1200, 630))
    save(og, ROOT / "og.png", mode="RGB")
    save(og, LOCKED / "og-LOCKED.png", mode="RGB")

    # ---- Icon / favicon set from icon-hero ----
    print("[derive] icon + favicon set…")
    # The generated icon is on cream already; round it into a card for icons.
    save(fit(icon, 1024, 1024), LOCKED / "icon-hero-LOCKED.png")
    icon1024 = fit(icon, 1024, 1024)
    save(icon1024, LOCKED / "icon-1024-LOCKED.png")
    save(fit(icon, 512, 512), LOCKED / "icon-512-LOCKED.png")
    save(fit(icon, 192, 192), LOCKED / "icon-192-LOCKED.png")
    apple = fit(icon, 180, 180)
    save(apple, LOCKED / "apple-touch-icon-LOCKED.png")
    save(fit(icon, 48, 48), LOCKED / "favicon-48-LOCKED.png")
    save(fit(icon, 32, 32), LOCKED / "favicon-32-LOCKED.png")
    save(fit(icon, 16, 16), LOCKED / "favicon-16-LOCKED.png")
    # multi-size .ico
    favicon_ico = LOCKED / "favicon-LOCKED.ico"
    imgs = [
        fit(icon, 48, 48),
        fit(icon, 32, 32),
        fit(icon, 16, 16),
    ]
    imgs[0].save(favicon_ico, format="ICO", sizes=[(48, 48), (32, 32), (16, 16)])

    # ---- Live root copies ----
    print("[derive] live root copies…")
    save(fit(icon, 512, 512), ROOT / "icon-512.png")
    save(fit(icon, 192, 192), ROOT / "icon-192.png")
    save(fit(icon, 180, 180), ROOT / "apple-touch-icon.png")
    save(fit(icon, 48, 48), ROOT / "favicon-48.png")
    save(fit(icon, 32, 32), ROOT / "favicon-32.png")
    save(fit(icon, 16, 16), ROOT / "favicon-16.png")
    imgs2 = [
        fit(icon, 48, 48),
        fit(icon, 32, 32),
        fit(icon, 16, 16),
    ]
    imgs2[0].save(ROOT / "favicon.ico", format="ICO", sizes=[(48, 48), (32, 32), (16, 16)])

    print("[derive] done.")


if __name__ == "__main__":
    main()
