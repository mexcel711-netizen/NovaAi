export const TOKEN_KEY = 'nova-desktop-bridge-token';

export function getDesktopBridgeToken(): string {
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

export async function runDesktopApp(app: string): Promise<void> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ app }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Desktop action failed.');
}

export async function openChromeNewTab(url?: string): Promise<void> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/chrome/new-tab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(url ? { url } : {}),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Chrome new tab action failed.');
}

export async function searchInChrome(query: string): Promise<void> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/chrome/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Chrome search failed.');
}

export async function openDesktopLocation(location: string): Promise<void> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/open-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ location }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Folder open failed.');
}

export async function listDesktopFiles(
  location: string
): Promise<{ path: string; entries: Array<{ name: string; type: 'dir' | 'file' }> }> {
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/files/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ location }),
  });
  const data = (await response.json()) as {
    error?: string;
    path?: string;
    entries?: Array<{ name: string; type: 'dir' | 'file' }>;
  };
  if (!response.ok) throw new Error(data.error || 'Unable to list laptop folder.');
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
  const token = requireToken();
  const response = await fetch('http://127.0.0.1:3210/v1/system/info', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await response.json()) as {
    error?: string;
    hostname: string;
    platform: string;
    cpuCount: number;
    cpuModel: string;
    totalMemoryGb: number;
    freeMemoryGb: number;
    uptimeMinutes: number;
  };
  if (!response.ok) throw new Error(data.error || 'Unable to read laptop system info.');
  return data;
}
