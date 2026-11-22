#!/bin/sh
# Prints the top of a GitHub release's notes: how to install, and direct downloads with plain names.
# The release workflow passes it to `gh release create --notes-file`; GitHub appends the changelog.
# Usage: packaging/release-notes.sh <version> [prerelease: true|false]
set -eu
v=${1:?usage: release-notes.sh <version> [prerelease]}
pre=${2:-false}
base="https://github.com/baobab-tech/pMCPg/releases/download/v$v"
pin=""
[ "$pre" = true ] && pin="PMCPG_VERSION=$v "

dl() { printf '[Download](%s/pmcpg-%s-%s)' "$base" "$v" "$1"; }

if [ "$pre" = true ]; then
  printf '> **Preview release.** For testing; the commands below install this exact version.\n\n'
fi

cat <<EOF
## Install

**Mac or Linux.** Open Terminal and paste:

\`\`\`bash
curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | ${pin}sh
\`\`\`

**Windows.** Open PowerShell and paste:

\`\`\`powershell
EOF
if [ "$pre" = true ]; then
  printf '$env:PMCPG_VERSION="%s"; irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex\n' "$v"
else
  printf 'irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex\n'
fi
cat <<EOF
\`\`\`

The installer checks the download, sets pMCPg to start at login, adds a **pMCPg** app to your launcher, and opens the setup page in your browser. Run it again to upgrade.

## Direct downloads

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 and later) | $(dl darwin-arm64.tar.gz) |
| Mac with Intel | $(dl darwin-x64.tar.gz) |
| Windows | $(dl windows-x64.zip) |
| Windows on ARM | $(dl windows-arm64.zip) |
| Linux (x64) | $(dl linux-x64.tar.gz) |
| Linux (ARM64) | $(dl linux-arm64.tar.gz) |
| Alpine / musl Linux (x64) | $(dl linux-x64-musl.tar.gz) |
| Alpine / musl Linux (ARM64) | $(dl linux-arm64-musl.tar.gz) |

After unpacking, run \`pmcpg service install\`, then \`pmcpg open\`. Details: [Install guide](https://github.com/baobab-tech/pMCPg/blob/main/docs/install.md#manual-install).

**For developers:** \`npx private-mcp-gateway\` · \`brew install baobab-tech/tap/pmcpg\` · \`docker pull ghcr.io/baobab-tech/pmcpg:slim\`

**Verify:** every file is listed in \`SHA256SUMS\` and has a build attestation: \`gh attestation verify <file> --repo baobab-tech/pMCPg\`.

EOF
