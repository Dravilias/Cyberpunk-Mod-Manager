const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectModZip: () => ipcRenderer.invoke('selectModZip'),
    installModFromPath: (zipPath) => ipcRenderer.invoke('installModFromPath', zipPath),
    getInstalledMods: () => ipcRenderer.invoke('getInstalledMods'),
    deleteMod: (modName) => ipcRenderer.invoke('deleteMod', modName),
    setModEnabled: (modName, enabled) => ipcRenderer.invoke('setModEnabled', modName, enabled),
    getNexusApiKey: () => ipcRenderer.invoke('getNexusApiKey'),
    setNexusApiKey: (apiKey) => ipcRenderer.invoke('setNexusApiKey', apiKey),
    checkModUpdates: () => ipcRenderer.invoke('checkModUpdates'),
    openModPage: (modName) => ipcRenderer.invoke('openModPage', modName),
    getGamePath: () => ipcRenderer.invoke('getGamePath'),
    selectGamePath: () => ipcRenderer.invoke('selectGamePath'),
    onInstallProgress: (callback) => ipcRenderer.on('installProgress', (event, progress) => callback(progress))
});