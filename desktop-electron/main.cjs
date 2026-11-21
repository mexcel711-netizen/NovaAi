const { app, BrowserWindow, ipcMain, shell, utilityProcess, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APP_URL = process.env.ZARA_APP_URL || 'https://novaai.mexcel711.workers.dev';
const APP_ORIGIN = new URL(APP_URL).origin;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 3210;
const BRIDGE_TOKEN = randomBytes(32).toString('hex');
const DATA_DIR = path.join(app.getPath('documents'), 'ZARA AI');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
let mainWindow = null;
let desktopAgent = null;
let quitting = false;
let bridgeReady = false;

function log(level, message, detail) {
  const line = '[' + new Date().toISOString() + '] [' + level + '] ' + message + (detail ? ' ' + JSON.stringify(detail) : '');
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'zara_main.log'), line + '\n', 'utf8');
  } catch (error) {
    process.stderr.write(line + ' (log write failed: ' + String(error) + ')\n');
  }
}

function bootstrapData() {
  for (const directory of [DATA_DIR, LOG_DIR, MEDIA_DIR, EXPORT_DIR]) fs.mkdirSync(directory, { recursive: true });
  const bundledSoul = app.isPackaged ? path.join(process.resourcesPath, 'SOUL.md') : path.join(__dirname, '..', 'SOUL.md');
  const soulPath = path.join(DATA_DIR, 'SOUL.md');
  const memoryPath = path.join(DATA_DIR, 'MEMORY.md');
  if (!fs.existsSync(soulPath) && fs.existsSync(bundledSoul)) {
    fs.copyFileSync(bundledSoul, soulPath);
    log('INFO', 'Bootstrap copied default SOUL.md');
  }
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, '# ZARA AI Memory\n\nThis file is reserved for your personal MEMORY.md. It has not been populated yet.\n', 'utf8');
    log('INFO', 'Bootstrap created empty MEMORY.md placeholder');
  }
  log('INFO', 'ZARA data directories ready', { dataDir: DATA_DIR });
}

function assertTrustedSender(event) {
  try {
    if (new URL(event.senderFrame.url).origin === APP_ORIGIN) return;
  } catch {}
  throw new Error('This desktop action is only available to the trusted ZARA application.');
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForBridge() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://' + BRIDGE_HOST + ':' + BRIDGE_PORT + '/v1/health', {
        headers: { Authorization: 'Bearer ' + BRIDGE_TOKEN, Origin: APP_ORIGIN },
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) { bridgeReady = true; return true; }
    } catch {}
    await delay(200);
  }
  throw new Error('ZARA desktop bridge did not become ready within 6 seconds.');
}

async function agentRequest(event, route, body, method = 'POST') {
  assertTrustedSender(event);
  await waitForBridge();
  const response = await fetch('http://' + BRIDGE_HOST + ':' + BRIDGE_PORT + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + BRIDGE_TOKEN,
      Origin: APP_ORIGIN,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Desktop action failed (HTTP ' + response.status + ').');
  return data;
}

function registerDesktopHandlers() {
  ipcMain.handle('zara:launch-app', (event, appName) => agentRequest(event, '/v1/launch', { app: appName }));
  ipcMain.handle('zara:chrome-new-tab', (event, url) => agentRequest(event, '/v1/chrome/new-tab', url ? { url } : {}));
  ipcMain.handle('zara:chrome-search', (event, query) => agentRequest(event, '/v1/chrome/search', { query }));
  ipcMain.handle('zara:open-location', (event, location) => agentRequest(event, '/v1/open-location', { location }));
  ipcMain.handle('zara:list-files', (event, location) => agentRequest(event, '/v1/files/list', { location }));
  ipcMain.handle('zara:system-info', (event) => agentRequest(event, '/v1/system/info', undefined, 'GET'));
  ipcMain.handle('zara:runtime-info', (event) => {
    assertTrustedSender(event);
    return { version: app.getVersion(), platform: process.platform, dataDir: DATA_DIR, bridgeReady };
  });
  ipcMain.handle('zara:open-external', async (event, rawUrl) => {
    assertTrustedSender(event);
    const target = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Only safe HTTP/HTTPS links can be opened.');
    await shell.openExternal(target.href);
    return { ok: true };
  });
  log('INFO', 'Desktop IPC handlers registered');
}

function startDesktopAgent() {
  const agentPath = app.isPackaged
    ? path.join(process.resourcesPath, 'desktop-companion', 'agent.mjs')
    : path.join(__dirname, '..', 'desktop-companion', 'agent.mjs');
  if (!fs.existsSync(agentPath)) { log('ERROR', 'Desktop companion entry point missing', { agentPath }); return; }
  desktopAgent = utilityProcess.fork(agentPath, [], {
    serviceName: 'ZARA Desktop Bridge',
    stdio: 'pipe',
    env: {
      ...process.env,
      NOVA_BRIDGE_HOST: BRIDGE_HOST,
      NOVA_BRIDGE_PORT: String(BRIDGE_PORT),
      NOVA_BRIDGE_TOKEN: BRIDGE_TOKEN,
      NOVA_ALLOWED_ORIGIN: APP_ORIGIN
    }
  });
  desktopAgent.stdout?.on('data', (chunk) => log('INFO', '[DesktopManager] ' + String(chunk).trim()));
  desktopAgent.stderr?.on('data', (chunk) => log('WARN', '[DesktopManager] ' + String(chunk).trim()));
  desktopAgent.on('spawn', () => log('INFO', 'Desktop companion process started'));
  desktopAgent.on('exit', (code) => { bridgeReady = false; log(code === 0 ? 'INFO' : 'WARN', 'Desktop companion process exited', { code }); });
  log('INFO', 'Desktop control handlers started');
}

function isTrustedNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === APP_ORIGIN || (url.protocol === 'https:' && url.hostname.endsWith('.cloudflareaccess.com'));
  } catch { return false; }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 680,
    show: false, backgroundColor: '#070b14', title: 'ZARA AI', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (['http:', 'https:'].includes(target.protocol)) void shell.openExternal(target.href);
    } catch { log('WARN', 'Blocked malformed external window URL'); }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) {
      event.preventDefault();
      log('WARN', 'Blocked navigation outside ZARA and Cloudflare Access origins', { url });
    }
  });
  mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show(); log('INFO', 'Main window ready-to-show'); });
  const fallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) { mainWindow.show(); log('WARN', 'ready-to-show timed out; showing window anyway'); }
  }, 15000);
  mainWindow.once('closed', () => { clearTimeout(fallback); mainWindow = null; log('INFO', 'Main window closed'); });
  mainWindow.loadURL(APP_URL).catch((error) => {
    log('ERROR', 'Failed to load ZARA web application', { message: String(error) });
    if (mainWindow) void dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'ZARA AI connection error',
      message: 'ZARA AI could not connect to its hosted application.', detail: String(error)
    });
  });
}

function configureUpdater() {
  if (!app.isPackaged) { log('INFO', 'Updater skipped in development mode'); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => log('INFO', '[Staged Updater] Checking for updates'));
  autoUpdater.on('update-available', (info) => log('INFO', '[Staged Updater] Update available', { version: info.version }));
  autoUpdater.on('update-not-available', (info) => log('INFO', '[Staged Updater] No newer version', { version: info.version }));
  autoUpdater.on('download-progress', (progress) => log('INFO', '[Staged Updater] Download progress', { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', async (info) => {
    log('INFO', '[Staged Updater] Update downloaded', { version: info.version });
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info', buttons: ['Restart and install', 'Later'], defaultId: 0, cancelId: 1,
      title: 'ZARA AI update ready', message: 'ZARA AI ' + info.version + ' is ready to install.'
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (error) => log('WARN', '[Staged Updater] Update check failed', { message: error.message }));
  setTimeout(() => {
    log('INFO', '[Staged Updater] Initial startup check scheduled');
    autoUpdater.checkForUpdatesAndNotify().catch((error) => log('WARN', '[Staged Updater] Startup check failed', { message: String(error) }));
  }, 8000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => log('WARN', '[Staged Updater] Periodic check failed', { message: String(error) }));
  }, 4 * 60 * 60 * 1000);
}

function shutdown(reason) {
  if (quitting) return;
  quitting = true;
  log('INFO', '[Shutdown] Started', { reason });
  if (desktopAgent) {
    try { desktopAgent.kill(); } catch (error) { log('WARN', 'Desktop companion cleanup failed', { message: String(error) }); }
    desktopAgent = null;
  }
  log('INFO', '[Shutdown] Teardown finished');
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.mexcel711.zara-ai');
    bootstrapData();
    registerDesktopHandlers();
    startDesktopAgent();
    createMainWindow();
    configureUpdater();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  }).catch((error) => {
    log('ERROR', 'Application bootstrap failed', { message: String(error) });
    app.quit();
  });
  app.on('before-quit', () => shutdown('before-quit'));
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
