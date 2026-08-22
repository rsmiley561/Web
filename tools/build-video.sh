#!/usr/bin/env bash
# Encodes the source .mov clips into exactly the web assets the site uses:
#   <slug>-hero.mp4    1600x900  full-bleed hero background
#   <slug>-720.mp4     1280x720  motion reel cards
#   <slug>-poster.jpg  1920x1080 poster frame (and the only thing low-data
#                                visitors ever see, so it must stand alone)
# Backgrounds are muted autoplay loops, so audio is stripped entirely.
#
#   SRC_DIR=/path/to/movs bash tools/build-video.sh
set -euo pipefail
FF="$(dirname "$0")/../node_modules/ffmpeg-static/ffmpeg"
SRC="${SRC_DIR:?set SRC_DIR to the folder holding the source .mov files}"
OUT="$(dirname "$0")/../assets/video"
mkdir -p "$OUT"

enc () { # <infile> <slug> <poster-second>
  local in="$1" slug="$2" pt="$3"
  "$FF" -y -loglevel error -i "$in" -an -sn -dn -map 0:v:0 \
    -vf "scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900,format=yuv420p" \
    -c:v libx264 -profile:v high -preset slow -crf 30 -maxrate 2200k -bufsize 4M \
    -movflags +faststart "$OUT/$slug-hero.mp4"
  "$FF" -y -loglevel error -i "$in" -an -sn -dn -map 0:v:0 \
    -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p" \
    -c:v libx264 -profile:v main -preset slow -crf 30 -maxrate 1600k -bufsize 3M \
    -movflags +faststart "$OUT/$slug-720.mp4"
  "$FF" -y -loglevel error -ss "$pt" -i "$in" -frames:v 1 \
    -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
    "$OUT/$slug-poster.jpg"
  echo "  $slug"
}

enc "$SRC/114eb016-IMG_0118.mov" tartare 3   # beef tartare on a black plate
enc "$SRC/26a2d363-IMG_9474.mov" brisket 4   # brisket press, smoke ring
enc "$SRC/95c68ac7-IMG_0075.mov" tower   3   # tuna / avocado / mango tower
enc "$SRC/de5efb5f-IMG_1744.mov" carrots 4   # glazed carrots, chimichurri
echo "done"
