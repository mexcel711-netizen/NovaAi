const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zaraDesktop', Object.freeze({
  launchApp: (appName) => ipcRenderer.invoke('zara:launch-app', appName),
  openChromeNewTab: (url) => ipcRenderer.invoke('zara:chrome-new-tab', url),
  searchInChrome: (query) => ipcRenderer.invoke('zara:chrome-search', query),
  openLocation: (location) => ipcRenderer.invoke('zara:open-location', location),
  listFiles: (location) => ipcRenderer.invoke('zara:list-files', location),
  getSystemInfo: () => ipcRenderer.invoke('zara:system-info'),
  getRuntimeInfo: () => ipcRenderer.invoke('zara:runtime-info'),
  openExternal: (url) => ipcRenderer.invoke('zara:open-external', url)
}));
