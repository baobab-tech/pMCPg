# Installs or upgrades pmcpg (Private MCP Gateway) on Windows. PowerShell 5.1 and 7.
#   irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex
#
# Environment:
#   PMCPG_VERSION      version to install, e.g. 0.1.0 (default: latest release)
#   PMCPG_INSTALL_DIR  where to put pmcpg.exe (default: %LOCALAPPDATA%\pmcpg\bin)
#   PMCPG_NO_START=1   skip `pmcpg service install` and `pmcpg open`
#   PMCPG_BASE_URL     release download base, for testing (default: the GitHub releases URL)
#
# Everything runs inside Install-Pmcpg, called on the last line. Errors throw instead of `exit`,
# which would close the window when run through `iex`.

function Install-Pmcpg {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # the progress bar slows Invoke-WebRequest a lot on 5.1
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }

  function Say([string]$msg) { Write-Host "pmcpg: $msg" }

  # Release target. OSArchitecture reports the OS, not this process, so x64 PowerShell on ARM64 still gets arm64.
  $arch = $null
  try { $arch = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch {}
  if (-not $arch) { $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE } }
  switch -Regex ($arch) {
    '^(X64|AMD64)$' { $target = 'windows-x64' }
    '^(Arm64|ARM64)$' { $target = 'windows-arm64' }
    default { throw "pmcpg: unsupported CPU: $arch" }
  }

  $base = if ($env:PMCPG_BASE_URL) { $env:PMCPG_BASE_URL.TrimEnd('/') } else { 'https://github.com/baobab-tech/pMCPg/releases' }
  $version = if ($env:PMCPG_VERSION) { $env:PMCPG_VERSION.TrimStart('v') } else { '' }
  $url = if ($version) { "$base/download/v$version" } else { "$base/latest/download" }
  $dir = if ($env:PMCPG_INSTALL_DIR) { $env:PMCPG_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'pmcpg\bin' }
  $exe = Join-Path $dir 'pmcpg.exe'

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("pmcpg-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $label = if ($version) { $version } else { 'latest' }
    Say "Downloading the $label release for $target"
    $sums = Join-Path $tmp 'SHA256SUMS'
    try { Invoke-WebRequest -UseBasicParsing -Uri "$url/SHA256SUMS" -OutFile $sums }
    catch { throw "pmcpg: could not download $url/SHA256SUMS ($($_.Exception.Message))" }

    # Lines are "<hash>  <file>", with an optional '*' before the file name.
    $archive = $null; $want = $null
    foreach ($line in Get-Content $sums) {
      $parts = $line.Trim() -split '\s+', 2
      if ($parts.Count -ne 2) { continue }
      $name = $parts[1].TrimStart('*')
      if ($name -like 'pmcpg-*' -and $name.EndsWith("-$target.zip")) { $archive = $name; $want = $parts[0].ToLowerInvariant(); break }
    }
    if (-not $archive) { throw "pmcpg: no $target build in this release" }

    $zip = Join-Path $tmp $archive
    try { Invoke-WebRequest -UseBasicParsing -Uri "$url/$archive" -OutFile $zip }
    catch { throw "pmcpg: could not download $url/$archive ($($_.Exception.Message))" }
    $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
    if ($got -ne $want) { throw "pmcpg: checksum mismatch for $archive (expected $want, got $got). Nothing was installed." }
    Say 'Checksum verified'

    $x = Join-Path $tmp 'x'
    Expand-Archive -Path $zip -DestinationPath $x -Force
    $new = Join-Path $x 'pmcpg.exe'
    if (-not (Test-Path $new)) { throw "pmcpg: $archive has no pmcpg.exe" }

    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    # A running pmcpg.exe is locked. Stop the login task and any gateway run from this path, then replace it.
    if (Test-Path $exe) {
      # PowerShell 5.1 turns redirected native stderr into a terminating error under 'Stop'.
      $ErrorActionPreference = 'Continue'
      try { & schtasks.exe /End /TN pmcpg 2>&1 | Out-Null } catch {}
      $ErrorActionPreference = 'Stop'
      Get-Process -Name pmcpg -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
    Copy-Item -Path $new -Destination $exe -Force
    Unblock-File -Path $exe

    $installed = (& $exe version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "pmcpg: $exe does not run on this machine" }
    Say "Installed pmcpg $installed to $exe"

    # User PATH only. Read the raw registry value so entries like %USERPROFILE%\bin stay unexpanded.
    $key = Get-Item -Path 'HKCU:\Environment'
    $userPath = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    $entries = $userPath -split ';' | Where-Object { $_ }
    if ($entries -notcontains $dir) {
      $newPath = (@($entries) + $dir) -join ';'
      Set-ItemProperty -Path 'HKCU:\Environment' -Name 'Path' -Value $newPath -Type ExpandString
      # Tell Explorer the environment changed, so new terminals see the PATH.
      if (-not ('Pmcpg.Env' -as [type])) {
        Add-Type -Namespace Pmcpg -Name Env -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
      }
      $r = [UIntPtr]::Zero
      [Pmcpg.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null
      Say "Added $dir to your user PATH. Open a new terminal to use pmcpg."
    }
    if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$env:Path;$dir" }

    if ($env:PMCPG_NO_START -eq '1') {
      Say 'Skipped start (PMCPG_NO_START=1). Run `pmcpg service install`, then `pmcpg open`.'
      return
    }
    & $exe service install
    if ($LASTEXITCODE -ne 0) { throw 'pmcpg: `pmcpg service install` failed. Run `pmcpg serve` to start the gateway by hand.' }
    Start-Sleep -Seconds 2
    & $exe open
    if ($LASTEXITCODE -ne 0) { Say 'Run `pmcpg open` to open the web UI.' }
  }
  finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Install-Pmcpg
