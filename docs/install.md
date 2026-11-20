# Install

One binary, `pmcpg`, for macOS, Windows and Linux. Also on npm, Homebrew and Docker.

## One-line install

macOS and Linux:

```bash
curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex
```

The script:

- Downloads the build for your OS and CPU from GitHub Releases and checks it against `SHA256SUMS`. A mismatch stops the install.
- Puts `pmcpg` in `~/.local/bin` (Windows: `%LOCALAPPDATA%\pmcpg\bin`) without admin rights, and adds that folder to your PATH.
- Runs `pmcpg service install`, so the gateway starts at login, then `pmcpg open` to open the web UI.
- Upgrades in place when run again.

Options, as environment variables:

| Variable | Effect |
|---|---|
| `PMCPG_VERSION` | Install this version, e.g. `0.1.0`, instead of the latest |
| `PMCPG_INSTALL_DIR` | Install the binary here |
| `PMCPG_NO_START=1` | Skip `service install` and `open` |
| `PMCPG_BASE_URL` | Download from another base URL. For testing the script |

```bash
curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | PMCPG_VERSION=0.1.0 sh
```

To read the script first, download it, open it, then run `sh install.sh`.

### Uninstall

```bash
pmcpg service uninstall
rm ~/.local/bin/pmcpg
```

On Windows, run `pmcpg service uninstall`, then delete `%LOCALAPPDATA%\pmcpg`.

The PATH line the script added to your shell profile (or user PATH on Windows) stays; remove it by hand if you like. Your config and data stay too; [Configuration](configuration.md#configyaml) lists where.

## Other channels

| Channel | Command |
|---|---|
| npm | `npx private-mcp-gateway` |
| Homebrew | `brew install baobab-tech/tap/pmcpg` |
| Docker | `docker pull ghcr.io/baobab-tech/pmcpg:slim` |
| Manual download | [GitHub Releases](https://github.com/baobab-tech/pMCPg/releases/latest): `.tar.gz` for macOS and Linux (x64 and arm64, glibc and musl), `.zip` for Windows (x64 and arm64). See [Manual install](#manual-install) |

Every release ships SHA-256 sums (`SHA256SUMS`) and GitHub build provenance attestations.

```bash
gh attestation verify <downloaded-file> --repo baobab-tech/pMCPg
```

## Start at login

```bash
pmcpg service install     # launchd (macOS), Task Scheduler (Windows), systemd user unit (Linux)
pmcpg service uninstall
```

Open the web UI with `pmcpg open`. Until you set a password, the UI opens only through the one-time link this command creates, so other users of the computer cannot open it.

## Manual install

v0.1 binaries are not code-signed or notarized. The one-line installer handles this; a browser download needs these steps. Check the download against `SHA256SUMS` or the attestation, then clear the OS warning.

**macOS.** Gatekeeper blocks a downloaded binary that is not notarized. Remove the quarantine flag after extracting:

```bash
tar -xzf pmcpg-*-darwin-arm64.tar.gz
xattr -d com.apple.quarantine pmcpg
sudo mv pmcpg /usr/local/bin/
```

The install script, Homebrew and npm do not set the quarantine flag.

**Windows.** SmartScreen may show "Windows protected your PC" on first run. Choose **More info**, then **Run anyway**. To skip the prompt, unblock the file in PowerShell after extracting:

```powershell
Unblock-File .\pmcpg.exe
```

**Linux.** No extra step.

## Docker

| Tag | Base | Runs |
|---|---|---|
| `slim` | `distroless/cc` | Remote servers only |
| `full` | `node:24-slim` plus `uv` | Remote servers and stdio servers (`npx`, `uvx`), with a cache volume for downloads |

Neither image needs the Docker socket.

Secrets are encrypted rows in `/data/state.db` (AES-256-GCM). In Docker there is no OS keychain, so the master key comes from `PMCPG_MASTER_KEY` or, preferably, `PMCPG_MASTER_KEY_FILE`. A UI password is required.

```yaml
# compose.yaml
services:
  pmcpg:
    image: ghcr.io/baobab-tech/pmcpg:full
    ports:
      - "127.0.0.1:7431:7431"
    volumes:
      - pmcpg-data:/data
      - pmcpg-cache:/cache
    environment:
      PMCPG_MASTER_KEY_FILE: /run/secrets/pmcpg_master_key
    secrets:
      - pmcpg_master_key

secrets:
  pmcpg_master_key:
    file: ./pmcpg_master_key        # openssl rand -base64 32 > pmcpg_master_key

volumes:
  pmcpg-data:
  pmcpg-cache:
```

Keep the master key out of the data volume. Losing it means losing the stored credentials.

---

[← Back to README](../README.md)
