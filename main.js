const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
const rootFolders = ["archive", "r6", "bin", "engine", "red4ext", "mods"];
const modsDbPath = path.join(__dirname, 'mods.json');

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

function getCleanPath(entryName, stripDepth) {
    return entryName.split('/').slice(stripDepth).join('/')
}

function installMod(zipContents, stripDepth, gamePath) {
    let installedFiles = [];

    zipContents.forEach(entry => {
        if (entry.isDirectory) {
            return
        }
        const cleanPath = getCleanPath(entry.entryName, stripDepth);
        if (cleanPath.length == 0) {
            return
        }
        const finalPath = gamePath + '/' + cleanPath;
        const folder = path.dirname(finalPath);
        fs.mkdirSync(folder, { recursive: true }); 
        const fileData = entry.getData();
        fs.writeFileSync(finalPath, fileData);
        installedFiles.push(cleanPath);
    });
    return installedFiles;
}

function saveModRecord(modName, installedFiles) {
    if (!fs.existsSync(modsDbPath)) {
        fs.writeFileSync(modsDbPath, '[]');
    }
    const rawText = fs.readFileSync(modsDbPath, 'utf-8');
    const json = JSON.parse(rawText);
    const record = {
        name: modName,
        installDate: new Date().toISOString(),
        files: installedFiles 
    }
    json.push(record);
    fs.writeFileSync(modsDbPath, JSON.stringify(json, null, 2))
}

function readModRecords() {
    if (!fs.existsSync(modsDbPath)) {
        return [];
    }
    const rawText = fs.readFileSync(modsDbPath, 'utf-8');
    const json = JSON.parse(rawText);
    return json;
}

function deleteModRecord(modName, gamePath) {
    const modRecords = readModRecords();
    const targetMod = modRecords.find(modRecord => modRecord.name === modName);
    if (targetMod == null) {
        return 
    }
    targetMod.files.forEach(file => {
        const fullPath = gamePath + '/' + file;
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    });
    const remainingMods = modRecords.filter(modRecord => modRecord.name !== modName);
    fs.writeFileSync(modsDbPath, JSON.stringify(remainingMods, null, 2))
}

ipcMain.handle('getGamePath', () => store.get('gamePath', null));

ipcMain.handle('selectGamePath', () => {
    const result = dialog.showOpenDialogSync({ properties: ['openDirectory'] });
    if (!result) return store.get('gamePath', null);
    store.set('gamePath', result[0]);
    return result[0];
});

ipcMain.handle('selectModZip', () => {
    const result = dialog.showOpenDialogSync({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
    });
    if (!result) {
        return null
    };
    return result;
})

ipcMain.handle('installModFromPath', (event, zipPath) => {
    const gamePath = store.get('gamePath');
    if (!gamePath) return null;
    const zip = new admZip(zipPath);
    const zipContents = zip.getEntries();
    const stripDepth = getStripDepth(zipContents);
    const installedFiles = installMod(zipContents, stripDepth, gamePath);
    const rawName = path.basename(zipPath, '.zip')
    const cleanName = rawName.replace(/-\d.*$/, '')
    saveModRecord(cleanName, installedFiles);
    return cleanName;
})

ipcMain.handle('getInstalledMods', () => {
    return readModRecords();
})

ipcMain.handle('deleteMod', (event, modName) => {
    const gamePath = store.get('gamePath');
    if (!gamePath) return;
    deleteModRecord(modName, gamePath);
});

app.whenReady().then(() => {
    createWindow();
});