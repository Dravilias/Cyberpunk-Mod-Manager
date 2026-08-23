const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const Store = require('electron-store');
const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const store = new Store();
const rootFolders = ["archive", "r6", "bin", "engine", "red4ext", "mods"];
const modsDbPath = path.join(__dirname, 'mods.json');

let win;

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.loadFile('index.html');
    win.webContents.on('did-finish-load', () => {
        checkPath();
    });
}

function checkPath() {
    if (!store.has('gamePath')) {
        win.webContents.send("gamePathMissing", "You didnt select a game path");
    } else {
        win.webContents.send("gamePathMissing", "");
    }
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

function getCleanPath(entryName, stripDepth) {
    return entryName.split('/').slice(stripDepth).join('/')
}

function installMod(zipContents, stripDepth) {
    const gamePath = store.get('gamePath');
    if (!gamePath) return [];
    let installedFiles = [];

    zipContents.forEach(entry => {
        if (entry.isDirectory) return;
        const cleanPath = getCleanPath(entry.entryName, stripDepth);
        if (cleanPath.length == 0) return;
        const finalPath = gamePath + '/' + cleanPath;
        const folder = path.dirname(finalPath);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(finalPath, entry.getData());
        installedFiles.push(cleanPath);
    });
    return installedFiles;
}

function saveModRecord(modName, installedFiles) {
    if (!fs.existsSync(modsDbPath)) {
        fs.writeFileSync(modsDbPath, '[]');
    }
    const json = JSON.parse(fs.readFileSync(modsDbPath, 'utf-8'));
    json.push({ name: modName, installDate: new Date().toISOString(), files: installedFiles });
    fs.writeFileSync(modsDbPath, JSON.stringify(json, null, 2));
}

function readModRecords() {
    if (!fs.existsSync(modsDbPath)) return [];
    return JSON.parse(fs.readFileSync(modsDbPath, 'utf-8'));
}

function deleteModRecord(modName) {
    const gamePath = store.get('gamePath');
    if (!gamePath) return;

    const modRecords = readModRecords();
    const targetMod = modRecords.find(r => r.name === modName);
    if (!targetMod) return;
    targetMod.files.forEach(file => {
        const fullPath = gamePath + '/' + file;
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    });
    fs.writeFileSync(modsDbPath, JSON.stringify(modRecords.filter(r => r.name !== modName), null, 2));
}

ipcMain.handle('selectGamePath', () => {
    const result = dialog.showOpenDialogSync({ properties: ['openDirectory'] });
    if (!result) return null;
    store.set('gamePath', result[0]);
    checkPath();
});

ipcMain.handle('selectModZip', () => {
    const result = dialog.showOpenDialogSync({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
    });
    if (!result) return null;
    return result;
});

ipcMain.handle('installModFromPath', (event, zipPath) => {
    const zip = new admZip(zipPath);
    const zipContents = zip.getEntries();
    const stripDepth = getStripDepth(zipContents);
    const installedFiles = installMod(zipContents, stripDepth);
    const cleanName = path.basename(zipPath, '.zip').replace(/-\d.*$/, '');
    saveModRecord(cleanName, installedFiles);
    return cleanName;
});

ipcMain.handle('getInstalledMods', () => readModRecords());

ipcMain.handle('deleteMod', (event, modName) => deleteModRecord(modName));

app.whenReady().then(() => createWindow());