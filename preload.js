const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectModZip: () => ipcRenderer.invoke('selectModZip'),
    installModFromPath: (zipPath) => ipcRenderer.invoke('installModFromPath', zipPath),
    getInstalledMods: () => ipcRenderer.invoke('getInstalledMods'),
    deleteMod: (modName) => ipcRenderer.invoke('deleteMod', modName),
    selectGamePath: () => ipcRenderer.invoke('selectGamePath'),
    onmessage: (cb) => ipcRenderer.on('gamePathMissing', (_, message) => cb(message))
});