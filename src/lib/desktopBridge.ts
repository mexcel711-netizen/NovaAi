export const TOKEN_KEY = 'nova-desktop-bridge-token';

declare global {
  interface Window {
    zaraDesktop?: {
      launchApp: (appName: string) => Promise<unknown>;
      openChromeNewTab: (url?: string) => Promise<unknown>;
      searchInChrome: (query: string) => Promise<unknown>;
      openLocation: (location: string) => Promise<unknown>;
      listFiles: (location: string) => Promise<{ path?: string; entries?: Array<{ name: string; type: 'dir' | 'file' }> }>;
      getSystemInfo: () => Promise<{
        hostname: string; platform: string; cpuCount: number; cpuModel: string;
        totalMemoryGb: number; freeMemoryGb: number; uptimeMinutes: number;
      }>;
      getRuntimeInfo: () => Promise<{ version: string; platform: string; dataDir: string; bridgeReady: boolean }>;
      openExternal: (url: string) => Promise<unknown>;
    };
  }
}

export function getDesktopBridgeToken(): string {
  if (typeof window !== 'undefined' && window.zaraDesktop) return 'native-desktop-runtime';
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function requireToken(): string {
  const token = getDesktopBridgeToken();
  if (!token) {
    throw new Error(
      'Desktop companion pair nahi hai. Settings > Laptop & Installer ya Desktop Bridge mein pairing token enter karein.'
    );
  }
  return token;
}

async function requestCompanion<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210' + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Desktop action failed.');
  return data;
}

export async function runDesktopApp(app: string): Promise<void> {
  if (window.zaraDesktop) { await window.zaraDesktop.launchApp(app); return; }
  await requestCompanion('/v1/launch', { app });
}

export async function openChromeNewTab(url?: string): Promise<void> {
  if (window.zaraDesktop) { await window.zaraDesktop.openChromeNewTab(url); return; }
  await requestCompanion('/v1/chrome/new-tab', url ? { url } : {});
}

export async function searchInChrome(query: string): Promise<void> {
  if (window.zaraDesktop) { await window.zaraDesktop.searchInChrome(query); return; }
  await requestCompanion('/v1/chrome/search', { query });
}

export async function openDesktopLocation(location: string): Promise<void> {
  if (window.zaraDesktop) { await window.zaraDesktop.openLocation(location); return; }
  await requestCompanion('/v1/open-location', { location });
}

export async function listDesktopFiles(
  location: string
): Promise<{ path: string; entries: Array<{ name: string; type: 'dir' | 'file' }> }> {
  if (window.zaraDesktop) {
    const data = await window.zaraDesktop.listFiles(location);
    return { path: data.path || location, entries: data.entries || [] };
  }
  const data = await requestCompanion<{ path?: string; entries?: Array<{ name: string; type: 'dir' | 'file' }> }>('/v1/files/list', { location });
  return { path: data.path || location, entries: data.entries || [] };
}

export async function fetchDesktopSystemInfo(): Promise<{
  hostname: string;
  platform: string;
  cpuCount: number;
  cpuModel: string;
  totalMemoryGb: number;
  freeMemoryGb: number;
  uptimeMinutes: number;
}> {
  if (window.zaraDesktop) return window.zaraDesktop.getSystemInfo();
  return requestCompanion<{
    hostname: string;
    platform: string;
    cpuCount: number;
    cpuModel: string;
    totalMemoryGb: number;
    freeMemoryGb: number;
    uptimeMinutes: number;
  }>('/v1/system/info', undefined, 'GET');
}

export interface UsbDriveInfo {
  path: string;
  label: string;
  freeBytes?: number;
  sizeBytes?: number;
}

export async function listUsbDrives(): Promise<UsbDriveInfo[]> {
  if (window.zaraDesktop) {
    throw new Error('USB drive controls are not yet exposed by the native desktop shell.');
  }
  const data = await requestCompanion<{ drives?: UsbDriveInfo[] }>('/v1/usb/list', undefined, 'GET');
  return data.drives || [];
}

export async function transferMemoryToUsb(payload: {
  drivePath: string;
  jsonContent: string;
  markdownContent: string;
}): Promise<{ ok: boolean; drivePath: string; filePath: string; markdownPath: string }> {
  if (window.zaraDesktop) {
    throw new Error('USB memory transfer is not yet exposed by the native desktop shell.');
  }
  const data = await requestCompanion<{
    ok?: boolean; drivePath?: string; filePath?: string; markdownPath?: string;
  }>('/v1/usb/transfer', payload);
  if (!data.filePath) throw new Error('USB memory transfer failed.');
  return {
    ok: true,
    drivePath: data.drivePath || payload.drivePath,
    filePath: data.filePath,
    markdownPath: data.markdownPath || '',
  };
}
