import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindowsDesktopInstaller } from './desktopInstaller';

test('Windows installer creates an app shortcut and optional sign-in startup entries', () => {
  const agentSource = 'console.log("private companion source");';
  const batch = buildWindowsDesktopInstaller(agentSource, 'https://zara.example.com');

  assert.match(batch, /ZARA AI\\.lnk/);
  assert.match(batch, /ZARA Desktop Companion\\.lnk/);
  assert.match(batch, /Start ZARA automatically when you sign in to Windows/);
  assert.match(batch, /autostart=1#zara-bridge=/);
  assert.match(batch, /NOVA_BRIDGE_TOKEN/);
  assert.match(batch, /NOVA_ALLOWED_ORIGIN/);
  assert.doesNotMatch(batch, /private companion source/);
});

test('installer embeds the PowerShell payload in short base64-safe batch lines', () => {
  const batch = buildWindowsDesktopInstaller('console.log("agent");', 'https://zara.example.com');
  const lines = batch.split(/\\r?\\n/);
  const payloadLines = lines.filter((line) => /^(?:>|>>).* echo [A-Za-z0-9+/=]+$/.test(line));
  assert.ok(payloadLines.length > 1);
  assert.ok(payloadLines.every((line) => line.length < 3600));

  const base64 = payloadLines.map((line) => line.slice(line.lastIndexOf(' echo ') + 6)).join('');
  const decoded = Buffer.from(base64, 'base64').toString('utf16le');
  assert.match(decoded, /CreateShortcut/);
  assert.match(decoded, /Startup/);
  assert.match(decoded, /console\\.log/);
  assert.match(decoded, /private companion source|agent/);
});

test('installer rejects origins that could inject a script or a non-web scheme', () => {
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'javascript:alert(1)'));
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'https://example.com/path'));
  assert.throws(() => buildWindowsDesktopInstaller('agent', 'https://user:pass@example.com'));
});
