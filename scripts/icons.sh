#!/bin/sh
# Regenerates the launcher icons from src/cli/assets/icon.svg. macOS only (iconutil); needs rsvg-convert and magick.
#   sh scripts/icons.sh
set -eu
cd "$(dirname "$0")/../src/cli/assets"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
set_dir="$tmp/pmcpg.iconset"
mkdir "$set_dir"
for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" icon.svg -o "$set_dir/icon_${s}x${s}.png"
  rsvg-convert -w $((s * 2)) -h $((s * 2)) icon.svg -o "$set_dir/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$set_dir" -o pmcpg.icns
rsvg-convert -w 256 -h 256 icon.svg -o pmcpg.png
for s in 16 24 32 48 64 256; do rsvg-convert -w "$s" -h "$s" icon.svg -o "$tmp/ico-$s.png"; done
magick "$tmp"/ico-16.png "$tmp"/ico-24.png "$tmp"/ico-32.png "$tmp"/ico-48.png "$tmp"/ico-64.png "$tmp"/ico-256.png pmcpg.ico
ls -l pmcpg.icns pmcpg.png pmcpg.ico
