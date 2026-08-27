#!/usr/bin/env bash
# Playgama Bridge upload zip (YouTube Playables via Playgama + network).
# Usage: from cut-the-fuse/ or playgama/: ./playgama/make-playgama-bundle.sh
#
# Differs from dist/ (itch / CrazyGames / Poki) and cert/ (direct Playables):
#   - Strips YouTube game_api (Bridge owns platform bindings)
#   - Injects Playgama Bridge CDN + __CUT_THE_FUSE_PLAYGAMA__ flag
#   - Ships assets/audio/* (file-based audio — platform rule, no live synth beds)
#   - Ships playgama-bridge-config.json beside index.html
#   - Never packs Poki SDK, cert/, locked-branding/, tools/, bake leftovers
set -euo pipefail

PG_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$PG_DIR/.." && pwd)"
OUT_DIR="$PG_DIR/out"
STAGE="$OUT_DIR/stage"
ZIP="$OUT_DIR/cut-the-fuse-playgama.zip"
CONFIG="$PG_DIR/playgama-bridge-config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "error: missing $CONFIG" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/src" "$STAGE/assets" "$OUT_DIR"

cp "$CONFIG" "$STAGE/playgama-bridge-config.json"
cp "$ROOT/index.html" "$STAGE/index.html"
cp -R "$ROOT/src/." "$STAGE/src/"
cp -R "$ROOT/assets/." "$STAGE/assets/"

python3 - "$STAGE/index.html" <<'PY'
import re, sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")

# Drop Playables SDK — Bridge loads platform-native scripts when hosted by Playgama.
html = re.sub(
    r"\n?<!-- YouTube Playables SDK[\s\S]*?<script src=\"https://www\.youtube\.com/game_api/v1\"></script>\n?",
    "\n",
    html,
    count=1,
)

bridge_inject = """
<!-- PLAYGAMA_BUILD — Bridge SDK (required for developer.playgama.com upload) -->
<script>window.__CUT_THE_FUSE_PLAYGAMA__ = true; window.__CUT_THE_FUSE_PORTAL__ = true;</script>
<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>
"""
if "PLAYGAMA_BUILD" not in html:
    if "<head>" not in html:
        raise SystemExit("error: no <head> in index.html")
    html = html.replace("<head>", "<head>\n" + bridge_inject, 1)

Path(sys.argv[1]).write_text(html, encoding="utf-8")
PY

if [[ -e "$STAGE/cert" ]] || [[ -e "$STAGE/locked-branding" ]] || [[ -e "$STAGE/tools" ]]; then
  echo "error: forbidden paths in Playgama stage" >&2
  exit 1
fi
if grep -q 'youtube.com/game_api' "$STAGE/index.html"; then
  echo "error: YouTube Playables SDK must not appear in the Playgama zip" >&2
  exit 1
fi
if grep -q 'poki-sdk.js' "$STAGE/index.html"; then
  echo "error: Poki SDK must not appear in the Playgama zip" >&2
  exit 1
fi
if ! grep -q 'PLAYGAMA_BUILD' "$STAGE/index.html"; then
  echo "error: PLAYGAMA_BUILD marker missing from index.html" >&2
  exit 1
fi
if ! grep -q 'bridge.playgama.com/v2/stable/playgama-bridge.js' "$STAGE/index.html"; then
  echo "error: Playgama Bridge script missing from index.html" >&2
  exit 1
fi
if ! grep -q 'window.__CUT_THE_FUSE_PLAYGAMA__ = true' "$STAGE/index.html"; then
  echo "error: Playgama flag assignment missing from index.html" >&2
  exit 1
fi
if [[ ! -f "$STAGE/playgama-bridge-config.json" ]]; then
  echo "error: playgama-bridge-config.json missing from stage" >&2
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
echo "Zip size: ${MB} MiB (${BYTES} bytes)"
echo "Next: playgama/UPLOAD.md → Test Game on https://developer.playgama.com — do not Submit until QA walks."
