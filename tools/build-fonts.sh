#!/usr/bin/env bash
# Downloads the latin + latin-ext subsets of the site's webfonts from Google
# and rewrites them into assets/fonts.css pointing at local files.
#
# Self-hosting is deliberate: it drops a render-blocking third-party request,
# survives networks that block Google, and keeps the fonts pinned so a
# silent upstream change cannot shift the layout.
#
#   bash tools/build-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
# Fraunces carries its italic plus the SOFT and WONK axes the display type uses.
URL='https://fonts.googleapis.com/css2'
URL+='?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1'
URL+='&family=Inter:wght@300..600'
URL+='&family=Cormorant+Garamond:ital,wght@0,300..600;1,300..500'
URL+='&display=swap'

curl -sSf -A "$UA" "$URL" -o /tmp/gf-src.css
python3 tools/_fonts.py /tmp/gf-src.css
