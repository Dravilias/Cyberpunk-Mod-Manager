const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectModZip: () => ipcRenderer.invoke('selectModZip'),
    installModFromPath: (zipPath) => ipcRenderer.invoke('installModFromPath', zipPath)
});