#!/usr/bin/env bash
# Renders packaging/homebrew/pmcpg.rb for one release and prints it.
#   packaging/homebrew/render.sh <version> <SHA256SUMS file>
set -euo pipefail

version="$1"
sums="$2"
here="$(cd "$(dirname "$0")" && pwd)"

sha() {
  local hash
  hash="$(awk -v f="pmcpg-$version-$1.tar.gz" '$2 == f { print $1 }' "$sums")"
  if [[ ! "$hash" =~ ^[0-9a-f]{64}$ ]]; then
    echo "render.sh: no sha256 for pmcpg-$version-$1.tar.gz in $sums" >&2
    exit 1
  fi
  printf '%s' "$hash"
}

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "render.sh: bad version $version" >&2
  exit 1
fi
darwin_arm64="$(sha darwin-arm64)"
darwin_x64="$(sha darwin-x64)"
linux_arm64="$(sha linux-arm64)"
linux_x64="$(sha linux-x64)"

sed \
  -e "s/@@VERSION@@/$version/g" \
  -e "s/@@SHA256_DARWIN_ARM64@@/$darwin_arm64/" \
  -e "s/@@SHA256_DARWIN_X64@@/$darwin_x64/" \
  -e "s/@@SHA256_LINUX_ARM64@@/$linux_arm64/" \
  -e "s/@@SHA256_LINUX_X64@@/$linux_x64/" \
  -e '/^# Template\./d' \
  "$here/pmcpg.rb"
