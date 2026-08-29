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

for f in favicon.ico favicon-16.png favicon-32.png favicon-48.png \
         apple-touch-icon.png icon-192.png icon-512.png site.webmanifest; do
  if [[ -f "$ROOT/$f" ]]; then cp "$ROOT/$f" "$STAGE/"; fi
done

cp "$ROOT/index.html" "$STAGE/index.html"
cp -R "$ROOT/src/." "$STAGE/src/"
cp -R "$ROOT/assets/." "$STAGE/assets/"

python3 - "$STAGE/index.html" "$ROOT/site.webmanifest" "$STAGE" <<'PY'
import re, sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")
src_manifest, stage = Path(sys.argv[2]), Path(sys.argv[3])

flag = '<script>window.__CUT_THE_FUSE_PLAYABLES__ = true;</script>\n'
if "window.__CUT_THE_FUSE_PLAYABLES__ = true" not in html:
    needle = '<script src="https://www.youtube.com/game_api/v1"></script>'
    if needle not in html:
        raise SystemExit("error: YouTube game_api script missing from index.html")
    html = html.replace(needle, needle + "\n" + flag, 1)

# Absolute host / root paths — Playables serves the zip from a subdirectory.
html = html.replace("https://play.cutthefuse.com/apple-touch-icon.png?v=ctf2", "apple-touch-icon.png")
html = re.sub(r'href="/favicon-(\d+)\.png\?v=ctf2"', r'href="favicon-\1.png"', html)
html = html.replace('href="/favicon.ico?v=ctf2"', 'href="favicon.ico"')
html = html.replace('href="/site.webmanifest?v=ctf2"', 'href="site.webmanifest"')
html = html.replace("https://play.cutthefuse.com/", "./")
html = re.sub(r'https://play\.cutthefuse\.com[^\s\"\']*', '', html)

Path(sys.argv[1]).write_text(html, encoding="utf-8")

manifest = src_manifest.read_text(encoding="utf-8")
manifest = manifest.replace('"start_url": "/"', '"start_url": "./"')
manifest = manifest.replace("/icon-192.png?v=ctf2", "icon-192.png")
manifest = manifest.replace("/icon-512.png?v=ctf2", "icon-512.png")
manifest = re.sub(r'"src": "/og\.png\?v=ctf2"', '"src": "icon-512.png"', manifest)
(stage / "site.webmanifest").write_text(manifest, encoding="utf-8")
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
if grep -qE 'href="/favicon|href="/site\.webmanifest|play\.cutthefuse\.com/' "$STAGE/index.html"; then
  echo "error: absolute play.cutthefuse.com or root asset paths remain" >&2
  grep -nE 'play\.cutthefuse\.com|href="/favicon|href="/site' "$STAGE/index.html" >&2 || true
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
