const { app, BrowserWindow, ipcMain } = require('electron');
const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const modPath = "C:/Users/kubag/Documents/Mody Cyberpunk/Veegee Shop 2-13870-2-3-0-1747230324.zip";
const rootFolders = ["archive", "r6", "bin", "engine", "red4ext", "mods"];

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.loadFile('index.html');
}

function getStripDepth(zipContents) {
    for (const entry of zipContents) {
        const parts = entry.entryName.split('/');
        if (rootFolders.includes(parts[0])) {
            return 0;
        } else if (rootFolders.includes(parts[1])) {
            return 1;
        }
    }
    return -1;
}

function inspectModZip() {
    const zip = new admZip(modPath);
    const zipContents = zip.getEntries();
    const stripDepth = getStripDepth(zipContents);
    
    zipContents.forEach(entry => {
        const clean = getCleanPath(entry.entryName, stripDepth);
        console.log(entry.entryName, "->", clean);
    });
}

function getCleanPath(entryName, stripDepth) {
    return entryName.split('/').slice(stripDepth).join('/')
}

ipcMain.handle('getGameFiles', () => {
    return listGameFiles();
});

app.whenReady().then(() => {
    createWindow();
    inspectModZip();
});