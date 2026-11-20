#!/bin/sh
# Installs or upgrades pmcpg (Private MCP Gateway) on macOS and Linux.
#   curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh
#
# Environment:
#   PMCPG_VERSION      version to install, e.g. 0.1.0 (default: latest release)
#   PMCPG_INSTALL_DIR  where to put the binary (default: ~/.local/bin)
#   PMCPG_NO_START=1   skip `pmcpg service install` and `pmcpg open`
#   PMCPG_BASE_URL     release download base, for testing (default: the GitHub releases URL)
#
# Everything runs inside main, called on the last line, so a download cut off mid-pipe runs nothing.
set -eu

REPO_RELEASES="https://github.com/baobab-tech/pMCPg/releases"

say() { printf 'pmcpg: %s\n' "$*"; }
fail() {
  printf 'pmcpg: error: %s\n' "$*" >&2
  exit 1
}

# Prints the release target for this machine, e.g. darwin-arm64 or linux-x64-musl.
detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "unsupported OS: $os (this script is for macOS and Linux; on Windows use install.ps1)" ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "unsupported CPU: $arch" ;;
  esac
  # A shell running under Rosetta reports x86_64 on Apple silicon.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  suffix=""
  if [ "$os" = linux ] && is_musl; then suffix="-musl"; fi
  printf '%s-%s%s\n' "$os" "$arch" "$suffix"
}

is_musl() {
  for f in /lib/ld-musl-*.so.1 /usr/lib/ld-musl-*.so.1; do
    [ -e "$f" ] && return 0
  done
  ldd --version 2>&1 | grep -qi musl
}

# download <url> <file>
download() {
  if command -v curl > /dev/null 2>&1; then
    case "$1" in
      https://*) curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1" ;;
      *) curl -fsSL --retry 3 -o "$2" "$1" ;;
    esac
  elif command -v wget > /dev/null 2>&1; then
    case "$1" in
      https://*) wget -q --https-only -O "$2" "$1" ;;
      *) wget -q -O "$2" "$1" ;;
    esac
  else
    fail "needs curl or wget"
  fi
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "needs sha256sum or shasum to verify the download"
  fi
}

# Prints the archive name for <target> listed in <SHA256SUMS>, e.g. pmcpg-0.1.0-linux-x64.tar.gz.
archive_name() {
  awk -v t="-$1.tar.gz" '{ f = $2; sub(/^\*/, "", f) }
    f ~ /^pmcpg-/ && substr(f, length(f) - length(t) + 1) == t { print f; exit }' "$2"
}

# Prints the hash listed for <file> in <SHA256SUMS>.
listed_hash() {
  awk -v f="$1" '{ n = $2; sub(/^\*/, "", n) } n == f { print $1; exit }' "$2"
}

# Adds <dir> to PATH in the user's shell profile, or prints the line to add.
ensure_path() {
  dir="$1"
  case ":${PATH:-}:" in *":$dir:"*) return 0 ;; esac
  if [ "$dir" = "$HOME/.local/bin" ]; then
    # Single quotes on purpose: the profile expands $HOME and $PATH, not this script.
    # shellcheck disable=SC2016
    shown='$HOME/.local/bin'
  else
    shown="$dir"
  fi
  line="export PATH=\"$shown:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh) profile="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$(uname -s)" = Darwin ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi
      ;;
    fish)
      profile="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/pmcpg.fish"
      line="fish_add_path \"$dir\""
      ;;
    *) profile="$HOME/.profile" ;;
  esac
  if [ -f "$profile" ] && grep -qF "$line" "$profile"; then
    say "$dir is in $profile. Open a new terminal to use pmcpg."
    return 0
  fi
  if mkdir -p "$(dirname "$profile")" 2> /dev/null && printf '\n# Added by the pmcpg installer\n%s\n' "$line" >> "$profile" 2> /dev/null; then
    say "Added $dir to PATH in $profile. Open a new terminal to use pmcpg."
  else
    say "$dir is not on your PATH. Add this line to your shell profile:"
    printf '\n    %s\n\n' "$line"
  fi
}

main() {
  target="$(detect_target)"
  base="${PMCPG_BASE_URL:-$REPO_RELEASES}"
  base="${base%/}"
  version="${PMCPG_VERSION:-}"
  version="${version#v}"
  if [ -n "$version" ]; then url="$base/download/v$version"; else url="$base/latest/download"; fi
  dir="${PMCPG_INSTALL_DIR:-$HOME/.local/bin}"

  tmp="$(mktemp -d 2> /dev/null || mktemp -d -t pmcpg)"
  trap 'rm -rf "$tmp"' EXIT
  trap 'rm -rf "$tmp"; exit 130' INT TERM

  say "Downloading the ${version:-latest} release for $target"
  download "$url/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download $url/SHA256SUMS"
  archive="$(archive_name "$target" "$tmp/SHA256SUMS")"
  [ -n "$archive" ] || fail "no $target build in this release"
  download "$url/$archive" "$tmp/$archive" || fail "could not download $url/$archive"

  want="$(listed_hash "$archive" "$tmp/SHA256SUMS")"
  got="$(sha256_of "$tmp/$archive")"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    fail "checksum mismatch for $archive (expected $want, got $got). Nothing was installed."
  fi
  say "Checksum verified"

  mkdir -p "$tmp/x"
  tar -xzf "$tmp/$archive" -C "$tmp/x" pmcpg || fail "could not extract $archive"
  chmod 755 "$tmp/x/pmcpg"

  mkdir -p "$dir" || fail "could not create $dir. Set PMCPG_INSTALL_DIR to a folder you can write to."
  # Copy next to the target, then rename: a running pmcpg keeps its old file and the swap is atomic.
  cp "$tmp/x/pmcpg" "$dir/.pmcpg.new" || fail "could not write to $dir. Set PMCPG_INSTALL_DIR to a folder you can write to."
  mv -f "$dir/.pmcpg.new" "$dir/pmcpg"
  if [ "$(uname -s)" = Darwin ]; then xattr -d com.apple.quarantine "$dir/pmcpg" 2> /dev/null || true; fi

  installed="$("$dir/pmcpg" version 2> /dev/null)" || fail "$dir/pmcpg does not run on this machine"
  say "Installed pmcpg $installed to $dir/pmcpg"
  ensure_path "$dir"

  if [ "${PMCPG_NO_START:-}" = 1 ]; then
    say "Skipped start (PMCPG_NO_START=1). Run \`pmcpg service install\`, then \`pmcpg open\`."
    return 0
  fi
  "$dir/pmcpg" service install || fail "\`pmcpg service install\` failed. Run \`pmcpg serve\` to start the gateway by hand."
  # systemd does not restart a running unit on install; restart it so an upgrade takes effect.
  if [ "$(uname -s)" = Linux ] && command -v systemctl > /dev/null 2>&1; then
    systemctl --user try-restart pmcpg.service 2> /dev/null || true
  fi
  sleep 2
  "$dir/pmcpg" open || say "Run \`pmcpg open\` to open the web UI."
}

main "$@"
