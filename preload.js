const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getGameFiles: () => ipcRenderer.invoke("getGameFiles")
});