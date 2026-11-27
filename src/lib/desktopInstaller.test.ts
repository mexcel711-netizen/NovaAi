import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowsDesktopInstaller } from './desktopInstaller';

function decodePowerShell(batch: string): string {
  const payloadLines = batch
    .split(/\r?\n/)
    .filter((line) => /^(?:>|>>).* echo [A-Za-z0-9+/=]+$/.test(line));
  assert.ok(payloadLines.length > 1);
  assert.ok(payloadLines.every((line) => line.length < 3600));
  const base64 = payloadLines.map((line) => line.slice(line.lastIndexOf(' echo ') + 6)).join('');
  return Buffer.from(base64, 'base64').toString('utf16le');
}

test('Windows installer creates an app shortcut and optional sign-in startup entries', () => {
  const agentSource = 'console.log("private companion source");';
  const batch = buildWindowsDesktopInstaller(agentSource, 'https://zara.example.com');
  const powershell = decodePowerShell(batch);

  assert.match(powershell, /ZARA AI\.lnk/);
  assert.match(powershell, /ZARA Desktop Companion\.lnk/);
  assert.match(powershell, /Start ZARA automatically when you sign in to Windows/);
  assert.match(powershell, /autostart=1#zara-bridge=/);
  assert.match(powershell, /NOVA_BRIDGE_TOKEN/);
  assert.match(powershell, /NOVA_ALLOWED_ORIGIN/);
  assert.doesNotMatch(batch, /private companion source/);
  assert.doesNotMatch(powershell, /private companion source/);
});

test('installer embeds a PowerShell payload in short base64-safe batch lines', () => {
  const batch = buildWindowsDesktopInstaller('console.log("agent");', 'https://zara.example.com');
  const powershell = decodePowerShell(batch);
  assert.match(powershell, /CreateShortcut/);
  assert.match(powershell, /Startup/);
  assert.match(powershell, /FromBase64String/);
});

test('installer rejects origins that could inject a script or a non-web scheme', () => {
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'javascript:alert(1)'));
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'https://example.com/path'));
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'https://user:pass@example.com'));
});
