function base64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Utf8(value: string): string {
  return base64Bytes(new TextEncoder().encode(value));
}

function base64Utf16Le(value: string): string {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return base64Bytes(bytes);
}

/**
 * Build a Windows installer that creates a desktop shortcut, provisions a
 * one-device local companion token, and optionally registers app + companion
 * shortcuts in the current user's Startup folder.
 */
export function buildWindowsDesktopInstaller(agentSource: string, requestedOrigin: string): string {
  const parsedOrigin = new URL(requestedOrigin);
  if (
    !['http:', 'https:'].includes(parsedOrigin.protocol) ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error('Desktop installer origin must be a plain HTTP or HTTPS origin.');
  }

  const encodedAgent = base64Utf8(agentSource);
  const encodedOrigin = base64Utf8(parsedOrigin.origin);
  const powershell = `
$ErrorActionPreference = 'Stop'
$origin = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedOrigin}'))
$agentSource = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedAgent}'))
$installDir = Join-Path $env:LOCALAPPDATA 'ZARA AI'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$agentPath = Join-Path $installDir 'agent.mjs'
$vbsPath = Join-Path $installDir 'start-companion.vbs'
[IO.File]::WriteAllText($agentPath, $agentSource, [Text.UTF8Encoding]::new($false))

$tokenBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($tokenBytes)
$rng.Dispose()
$token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source
$vbs = @"
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("PROCESS")
env("NOVA_BRIDGE_TOKEN") = "$token"
env("NOVA_ALLOWED_ORIGIN") = "$origin"
shell.Run """"$nodePath"""" & " " & """"$agentPath"""", 0, False
"@
[IO.File]::WriteAllText($vbsPath, $vbs, [Text.UTF8Encoding]::new($false))

$appUrl = $origin + '/?autostart=1#zara-bridge=' + [uri]::EscapeDataString($token)
$edgeCandidates = @(
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

function Add-ZaraAppShortcut([string]$shortcutPath) {
  if ($edge) {
    $link = $shell.CreateShortcut($shortcutPath)
    $link.TargetPath = $edge
    $link.Arguments = '--app="' + $appUrl + '" --autoplay-policy=no-user-gesture-required'
    $link.WorkingDirectory = Split-Path -Parent $edge
    $link.Description = 'ZARA AI personal voice assistant'
    $link.Save()
  } else {
    $urlPath = [IO.Path]::ChangeExtension($shortcutPath, '.url')
    "[InternetShortcut]`r`nURL=$appUrl" | Set-Content -LiteralPath $urlPath -Encoding ASCII
  }
}

Add-ZaraAppShortcut (Join-Path $desktop 'ZARA AI.lnk')
$answer = Read-Host 'Start ZARA automatically when you sign in to Windows? [Y/n]'
if ($answer -notmatch '^[Nn]') {
  Add-ZaraAppShortcut (Join-Path $startup 'ZARA AI.lnk')
  $companionLink = $shell.CreateShortcut((Join-Path $startup 'ZARA Desktop Companion.lnk'))
  $companionLink.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $companionLink.Arguments = '"' + $vbsPath + '"'
  $companionLink.Description = 'Secure local ZARA desktop companion'
  $companionLink.Save()
  Write-Host 'Automatic sign-in startup enabled for ZARA and its local companion.'
} else {
  Write-Host 'Automatic sign-in startup skipped. The desktop shortcut is ready.'
}

$wscriptPath = Join-Path $env:WINDIR 'System32\wscript.exe'
Start-Process -FilePath $wscriptPath -ArgumentList ('"' + $vbsPath + '"') -WindowStyle Hidden
if ($edge) {
  Start-Process -FilePath $edge -ArgumentList @('--app="' + $appUrl + '"', '--autoplay-policy=no-user-gesture-required')
} else {
  Start-Process -FilePath $appUrl
}
Write-Host 'ZARA is installed. The desktop companion uses a private token stored on this PC.'
`.trim();

  const encodedPowerShell = base64Utf16Le(powershell);
  return [
    '@echo off',
    'setlocal',
    'where node.exe >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and run this installer again.',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + encodedPowerShell,
    'if errorlevel 1 (',
    '  echo ZARA installation failed. Check the PowerShell message above.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo ZARA desktop installation completed.',
    'pause',
  ].join('\\r\\n');
}
