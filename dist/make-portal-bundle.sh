#!/usr/bin/env bash
# Solo portal zip for itch / CrazyGames Basic / Poki.
# Usage:
#   ./dist/make-portal-bundle.sh           → out/cut-the-fuse-portal.zip  (no Poki SDK)
#   ./dist/make-portal-bundle.sh --poki    → out/cut-the-fuse-poki.zip    (+ PokiSDK)
#
# iframe-safe: relative asset paths, YouTube SDK stripped, no cert/locked-branding.
#   --poki injects PokiSDK (allowed CDN) + __CUT_THE_FUSE_POKI__
set -euo pipefail

DIST_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIST_DIR/.." && pwd)"
OUT_DIR="$DIST_DIR/out"
STAGE="$OUT_DIR/stage"

POKI=0
for arg in "$@"; do
  case "$arg" in
    --poki) POKI=1 ;;
    -h|--help)
      echo "Usage: $0 [--poki]"
      exit 0
      ;;
  esac
done

if [[ "$POKI" -eq 1 ]]; then
  ZIP="$OUT_DIR/cut-the-fuse-poki.zip"
else
  ZIP="$OUT_DIR/cut-the-fuse-portal.zip"
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/src" "$STAGE/assets" "$OUT_DIR"

for f in favicon.ico favicon-16.png favicon-32.png favicon-48.png \
         apple-touch-icon.png icon-192.png icon-512.png site.webmanifest; do
  if [[ -f "$ROOT/$f" ]]; then cp "$ROOT/$f" "$STAGE/"; fi
done

cp "$ROOT/index.html" "$STAGE/index.html"
cp -R "$ROOT/src/." "$STAGE/src/"
cp -R "$ROOT/assets/." "$STAGE/assets/"

python3 - "$STAGE/index.html" "$ROOT/site.webmanifest" "$STAGE" "$POKI" <<'PY'
import re, sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")
src_manifest, stage = Path(sys.argv[2]), Path(sys.argv[3])
poki = sys.argv[4] == "1"

# Drop Playables SDK — portal / Poki zips must not call youtube.com.
html = re.sub(
    r"\n?<!-- YouTube Playables SDK[\s\S]*?<script src=\"https://www\.youtube\.com/game_api/v1\"></script>\n?",
    "\n",
    html,
    count=1,
)

marker = "<!-- PORTAL_BUILD solo — no cert/, no marketing -->\n"
portal_flag = "<script>window.__CUT_THE_FUSE_PORTAL__=true;</script>\n"
poki_bits = (
    "<!-- POKI_BUILD — PokiSDK (allowed CDN) + gameplay/loading hooks -->\n"
    "<script src=\"https://game-cdn.poki.com/scripts/v2/poki-sdk.js\"></script>\n"
    "<script>window.__CUT_THE_FUSE_PORTAL__=true;window.__CUT_THE_FUSE_POKI__=true;</script>\n"
)

inject = marker + (poki_bits if poki else portal_flag)
if "<!-- PORTAL_BUILD" not in html and "<!-- POKI_BUILD" not in html:
    html = html.replace("<head>", "<head>\n" + inject, 1)
elif poki and "window.__CUT_THE_FUSE_POKI__" not in html:
    html = html.replace("<head>", "<head>\n" + poki_bits, 1)
elif (not poki) and "window.__CUT_THE_FUSE_PORTAL__" not in html:
    html = html.replace("<head>", "<head>\n" + portal_flag, 1)

# Absolute host / root paths — portal zips live under a subdirectory on itch/CDN.
html = html.replace("https://play.cutthefuse.com/apple-touch-icon.png?v=ctf1", "apple-touch-icon.png")
html = re.sub(r'href="/favicon-(\d+)\.png\?v=ctf1"', r'href="favicon-\1.png"', html)
html = html.replace('href="/favicon.ico?v=ctf1"', 'href="favicon.ico"')
html = html.replace('href="/site.webmanifest?v=ctf1"', 'href="site.webmanifest"')
html = re.sub(r'https://play\.cutthefuse\.com[^\s\"\']+', '', html)
Path(sys.argv[1]).write_text(html, encoding="utf-8")

manifest = src_manifest.read_text(encoding="utf-8")
manifest = manifest.replace('"start_url": "/"', '"start_url": "./"')
manifest = manifest.replace("/icon-192.png?v=ctf1", "icon-192.png")
manifest = manifest.replace("/icon-512.png?v=ctf1", "icon-512.png")
manifest = re.sub(r'"src": "/og\.png\?v=ctf1"', '"src": "icon-512.png"', manifest)
(stage / "site.webmanifest").write_text(manifest, encoding="utf-8")
PY

if [[ "$POKI" -eq 1 ]]; then
  if ! grep -q 'game-cdn.poki.com/scripts/v2/poki-sdk.js' "$STAGE/index.html"; then
    echo "error: Poki SDK script missing from --poki build" >&2
    exit 1
  fi
  if ! grep -q 'window.__CUT_THE_FUSE_POKI__=true' "$STAGE/index.html"; then
    echo "error: __CUT_THE_FUSE_POKI__ flag missing from --poki build" >&2
    exit 1
  fi
else
  if grep -q 'poki-sdk.js' "$STAGE/index.html"; then
    echo "error: Poki SDK must not appear in the generic portal zip (use --poki)" >&2
    exit 1
  fi
fi
if [[ -e "$STAGE/cert" ]] || [[ -e "$STAGE/locked-branding" ]] || [[ -e "$STAGE/tools" ]]; then
  echo "error: forbidden paths in portal stage" >&2
  exit 1
fi
if grep -q 'youtube.com/game_api' "$STAGE/index.html"; then
  echo "error: YouTube Playables SDK must not appear in the portal zip" >&2
  exit 1
fi

AUDIO_N=$(find "$STAGE/assets/audio" -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$AUDIO_N" -lt 1 ]]; then
  echo "warning: no baked audio in assets/audio yet — synth snip fallback ships (placeholder phase)"
fi

rm -f "$ZIP"
(
  cd "$STAGE"
  zip -qr "$ZIP" .
)

echo "Wrote $ZIP"
echo "Contents:"
unzip -l "$ZIP"
echo
BYTES=$(wc -c < "$ZIP" | tr -d ' ')
MB=$(awk "BEGIN { printf \"%.2f\", $BYTES / 1024 / 1024 }")
echo "Zip size: ${MB} MiB (${BYTES} bytes)  — Poki target ≪8MB"
if [[ "$POKI" -eq 1 ]]; then
  echo "Next: Poki dashboard → Add Game → upload cut-the-fuse-poki.zip → Inspector → request playtests"
else
  echo "Next: itch / CrazyGames Basic. Use --poki for Poki SDK build."
fi
