#!/usr/bin/env bash
# YouTube Playables / MC Play zip — SDK in source, no Playgama, no Poki.
# Usage: from cut-the-fuse/ or cert/: ./cert/make-bundle.sh  OR  ./make-bundle.sh
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$CERT_DIR/.." && pwd)"
OUT_DIR="$CERT_DIR/out"
STAGE="$OUT_DIR/stage"
ZIP="$OUT_DIR/cut-the-fuse-playables.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE/src" "$STAGE/assets" "$OUT_DIR"

cp "$ROOT/index.html" "$STAGE/index.html"
cp -R "$ROOT/src/." "$STAGE/src/"
cp -R "$ROOT/assets/." "$STAGE/assets/"

python3 - "$STAGE/index.html" <<'PY'
import re, sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")

flag = '<script>window.__CUT_THE_FUSE_PLAYABLES__ = true;</script>\n'
if "window.__CUT_THE_FUSE_PLAYABLES__ = true" not in html:
    needle = '<script src="https://www.youtube.com/game_api/v1"></script>'
    if needle not in html:
        raise SystemExit("error: YouTube game_api script missing from index.html")
    html = html.replace(needle, needle + "\n" + flag, 1)

Path(sys.argv[1]).write_text(html, encoding="utf-8")
PY

if [[ -e "$STAGE/playgama-bridge-config.json" ]] || [[ -e "$STAGE/cert" ]] || [[ -e "$STAGE/locked-branding" ]] || [[ -e "$STAGE/tools" ]]; then
  echo "error: forbidden paths in Playables stage" >&2
  exit 1
fi
if grep -q 'bridge.playgama.com' "$STAGE/index.html"; then
  echo "error: Playgama Bridge must not appear in the Playables zip" >&2
  exit 1
fi
if grep -q 'poki-sdk.js' "$STAGE/index.html"; then
  echo "error: Poki SDK must not appear in the Playables zip" >&2
  exit 1
fi
if ! grep -q 'youtube.com/game_api/v1' "$STAGE/index.html"; then
  echo "error: YouTube Playables SDK missing from index.html" >&2
  exit 1
fi
if ! grep -q 'window.__CUT_THE_FUSE_PLAYABLES__ = true' "$STAGE/index.html"; then
  echo "error: Playables flag missing from index.html" >&2
  exit 1
fi

bad_names=$(find "$STAGE" -type f -print | while IFS= read -r f; do
  base=$(basename "$f")
  if [[ ! "$base" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "$base"
  fi
done)
if [[ -n "$bad_names" ]]; then
  echo "error: Playables filenames must be alphanumeric plus _-." >&2
  echo "$bad_names" >&2
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
echo "Zip size: ${MB} MiB (${BYTES} bytes)  — initial MUST < 30 MiB"
echo "Upload this zip on MC Play (YouTube Playables). Do not upload the Playgama zip."
