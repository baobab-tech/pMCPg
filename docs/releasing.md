# Releasing

A `v*` tag push runs `.github/workflows/release.yml`:

1. `test`: `bun run check` and `bun test`. The only CI on a tag.
2. `ui`: builds the web UI static export, with no secrets and no install scripts.
3. `build`: compiles 8 binaries and signs them when signing secrets exist. Runs in the `release` environment.
4. `release`: archives, the install scripts (`packaging/install/install.sh` and `install.ps1`), `SHA256SUMS`, the Homebrew formula, attestations, the GitHub release.
5. `docker`: `slim` and `full` images to GHCR.
6. `npm` and `homebrew`: publish. Both run in the `release` environment.

A tag with a suffix (`v0.1.0-rc.1`) is a prerelease: GitHub marks it so, npm publishes under `next`, Docker skips the `slim` and `full` tags, Homebrew skips the tap.

Publishing steps skip with a notice when their secret or variable is missing, so a release runs before every channel is set up.

## One-time setup

Run these as an owner of `baobab-tech`. Set `R=baobab-tech/pMCPg` first.

```bash
R=baobab-tech/pMCPg
```

### 1. The `release` environment

Required reviewer: you. Only `v*` tags may deploy to it.

```bash
gh api -X PUT "repos/$R/environments/release" --input - <<EOF
{
  "reviewers": [{ "type": "User", "id": $(gh api user --jq .id) }],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
EOF
```

```bash
gh api -X POST "repos/$R/environments/release/deployment-branch-policies" -f name='v*' -f type=tag
```

Each run then waits for one approval before `build`, and again before `npm` and `homebrew`.

### 2. Protect `v*` tags

Only repository admins can create, move or delete a release tag.

```bash
gh api -X POST "repos/$R/rulesets" --input - <<'EOF'
{
  "name": "release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }],
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
}
EOF
```

`actor_id` 5 is the built-in Admin role.

### 3. Go public

Attestations and npm provenance need a public repository. On a private repository the workflow skips attestations and publishes to npm without provenance.

```bash
gh repo edit "$R" --visibility public --accept-visibility-change-consequences
```

Then turn on immutable releases: **Settings → General → Releases → Enable release immutability**. Once a release is published its assets cannot change. The workflow attaches every asset, the formula included, before it publishes.

### 4. Homebrew tap

```bash
gh repo create baobab-tech/homebrew-tap --public --add-readme --description "Homebrew formulae for pMCPg"
```

Create a fine-grained token at **github.com → Settings → Developer settings → Fine-grained tokens**:

- Resource owner: `baobab-tech`
- Repository access: only `baobab-tech/homebrew-tap`
- Permissions: Contents, read and write
- Expiry: one year, with a calendar reminder

```bash
gh secret set HOMEBREW_TAP_TOKEN --env release --repo "$R"
```

The first stable tag writes `Formula/pmcpg.rb`. Users install with `brew install baobab-tech/tap/pmcpg`.

### 5. npm

Packages: `private-mcp-gateway` and 8 platform packages, `@baobabtech/pmcpg-<os>-<arch>[-musl]`, where `<os>` is `darwin`, `win32` or `linux`. The `@baobabtech` npm organization must exist, and your npm account needs 2FA.

Trusted publishing (OIDC) is the goal: no long-lived token in GitHub. npm only accepts a trusted publisher for a package that already exists, so the first publish uses a token.

**First publish.**

1. On npmjs.com, create a granular access token: read and write on all packages, scoped to `@baobabtech`, 7-day expiry.
2. Store it:

   ```bash
   gh secret set NPM_TOKEN --env release --repo "$R"
   ```

3. Push the first tag (an rc is enough, see below). The `npm` job publishes all 9 packages.

**Switch to trusted publishing.** Needs npm 11.15 or later locally (`npm i -g npm@11` on Node 22 older than 22.22; npm 12 needs a newer Node).

```bash
for p in private-mcp-gateway @baobabtech/pmcpg-{darwin-arm64,darwin-x64,win32-x64,win32-arm64,linux-x64,linux-arm64,linux-x64-musl,linux-arm64-musl}; do
  npm trust github "$p" --repo "$R" --file release.yml --env release --allow-publish --yes
done
```

```bash
gh variable set NPM_TRUSTED_PUBLISHING --env release --repo "$R" --body true
```

```bash
gh secret delete NPM_TOKEN --env release --repo "$R"
```

Then revoke the token on npmjs.com, and under each package's **Settings → Publishing access**, choose "Require two-factor authentication and disallow tokens". Trusted publishing keeps working.

A trusted publisher that has not published within 2 days expires. Push the next tag soon after running `npm trust`.

### 6. GHCR

The first run pushes `ghcr.io/baobab-tech/pmcpg` as a private package. Make it public once: **github.com/orgs/baobab-tech/packages → pmcpg → Package settings → Change visibility → Public**. There is no API for this.

### 7. Signing (later)

macOS signing and notarization run when `APPLE_CERTIFICATE_P12` is set; Windows signing when `AZURE_SIGNING_ENDPOINT` is set. Store these as `release` environment secrets too. v0.1 ships unsigned.

## Test on an rc tag

```bash
git tag -s v0.1.0-rc.1 -m "v0.1.0-rc.1" && git push origin v0.1.0-rc.1
```

Approve the `release` deployment in the run, then check each platform. `V=0.1.0-rc.1`.

**All.** Verify checksums and provenance:

```bash
gh release download "v$V" --repo "$R" --dir rc && cd rc && shasum -a 256 -c SHA256SUMS
```

```bash
gh attestation verify pmcpg-$V-linux-x64.tar.gz --repo "$R"
```

**Install scripts.** `releases/latest/download/` skips prereleases, so pin the rc. On macOS and Linux:

```bash
curl -fsSL "https://github.com/$R/releases/download/v$V/install.sh" | PMCPG_VERSION=$V sh
```

On Windows, in PowerShell:

```powershell
$env:PMCPG_VERSION = "0.1.0-rc.1"; irm https://github.com/baobab-tech/pMCPg/releases/download/v0.1.0-rc.1/install.ps1 | iex
```

Each should install to the user folder, add it to PATH, start the service and open the web UI. Run it again to check the upgrade path. After the stable tag, check the `releases/latest/download/` URLs from the README.

**macOS** (arm64, and x64 if you have an Intel Mac):

1. Download the `.tar.gz` in a browser, so the quarantine flag is set.
2. Extract and run `./pmcpg version`: Gatekeeper blocks it.
3. `xattr -d com.apple.quarantine pmcpg`, then `./pmcpg version` prints `$V`.
4. `./pmcpg open`: the web UI loads.
5. `./pmcpg service install`, log out and in, the UI is still reachable. Open **pMCPg** from Spotlight: the UI opens. `./pmcpg service uninstall` removes `~/Applications/pMCPg.app`.

**Windows** (x64; arm64 if available):

1. Download the `.zip` in Edge and extract.
2. Run `pmcpg.exe version` from PowerShell. Note whether SmartScreen appears and that **More info → Run anyway** works.
3. `Unblock-File .\pmcpg.exe` clears it.
4. `pmcpg.exe open`, then `service install`. Open **pMCPg** from the Start menu: the UI opens. `service uninstall` removes the shortcut.

**Linux** (x64 glibc, plus one musl target in Alpine):

```bash
tar -xzf pmcpg-$V-linux-x64.tar.gz && ./pmcpg version && ./pmcpg open
```

```bash
docker run --rm -v "$PWD:/w" alpine:3 /w/pmcpg version   # after extracting pmcpg-$V-linux-x64-musl.tar.gz
```

**Docker:**

```bash
docker run --rm ghcr.io/baobab-tech/pmcpg:$V-slim version
```

```bash
docker run --rm ghcr.io/baobab-tech/pmcpg:$V-full version
```

Then run `packaging/docker/compose.yaml` with a master key file and open `http://127.0.0.1:7431`.

**npm** (if published):

```bash
npx private-mcp-gateway@next version
```

**Homebrew** is skipped for prereleases. After the stable tag: `brew install baobab-tech/tap/pmcpg && pmcpg version`.

When all pass, push `v0.1.0`.
