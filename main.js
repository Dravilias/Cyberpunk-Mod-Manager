const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

// Keep the data folder from before productName was set, so the saved game path survives.
app.setPath('userData', path.join(app.getPath('appData'), 'cyberpunk-mod-manager'));

const store = new Store();
const rootFolders = ["archive", "r6", "bin", "engine", "red4ext", "mods"];
const modsDbPath = path.join(app.getPath('userData'), 'mods.json');
const disabledFolderName = '.cmm-disabled';

// mods.json used to live next to the source; carry it over on first run.
const legacyModsDbPath = path.join(__dirname, 'mods.json');
if (!fs.existsSync(modsDbPath) && fs.existsSync(legacyModsDbPath)) {
    fs.mkdirSync(path.dirname(modsDbPath), { recursive: true });
    fs.copyFileSync(legacyModsDbPath, modsDbPath);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 800,
        title: 'Cyberpunk Mod Manager',
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets', 'icon.png'),
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

async function installMod(zipContents, stripDepth, gamePath, onProgress) {
    let installedFiles = [];
    const files = zipContents.filter(entry => !entry.isDirectory);
    let done = 0;

    for (const entry of files) {
        const cleanPath = getCleanPath(entry.entryName, stripDepth);
        if (cleanPath.length > 0) {
            const finalPath = gamePath + '/' + cleanPath;
            const folder = path.dirname(finalPath);
            await fs.promises.mkdir(folder, { recursive: true });
            const fileData = entry.getData();
            await fs.promises.writeFile(finalPath, fileData);
            installedFiles.push(cleanPath);
        }
        done++;
        onProgress(done, files.length);
    }
    return installedFiles;
}

function writeModRecords(records) {
    fs.mkdirSync(path.dirname(modsDbPath), { recursive: true });
    fs.writeFileSync(modsDbPath, JSON.stringify(records, null, 2))
}

function saveModRecord(modName, installedFiles) {
    const json = readModRecords();
    const record = {
        name: modName,
        installDate: new Date().toISOString(),
        enabled: true,
        files: installedFiles 
    }
    json.push(record);
    writeModRecords(json);
}

function readModRecords() {
    if (!fs.existsSync(modsDbPath)) {
        return [];
    }
    const rawText = fs.readFileSync(modsDbPath, 'utf-8');
    const json = JSON.parse(rawText);
    return json;
}

function isEnabled(modRecord) {
    // Records saved before disabling existed have no flag and are enabled.
    return modRecord.enabled !== false;
}

function getDisabledModPath(gamePath, modName) {
    return path.join(gamePath, disabledFolderName, modName);
}

function deleteModRecord(modName, gamePath) {
    const modRecords = readModRecords();
    const targetMod = modRecords.find(modRecord => modRecord.name === modName);
    if (targetMod == null) {
        return 
    }
    if (isEnabled(targetMod)) {
        targetMod.files.forEach(file => {
            const fullPath = gamePath + '/' + file;
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        });
    } else {
        fs.rmSync(getDisabledModPath(gamePath, modName), { recursive: true, force: true });
    }
    const remainingMods = modRecords.filter(modRecord => modRecord.name !== modName);
    writeModRecords(remainingMods);
}

function moveFile(from, to) {
    if (!fs.existsSync(from)) {
        return
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

function setModEnabled(modName, gamePath, enabled) {
    const modRecords = readModRecords();
    const targetMod = modRecords.find(modRecord => modRecord.name === modName);
    if (targetMod == null || isEnabled(targetMod) === enabled) {
        return
    }
    const disabledPath = getDisabledModPath(gamePath, modName);
    targetMod.files.forEach(file => {
        const livePath = path.join(gamePath, file);
        const storedPath = path.join(disabledPath, file);
        if (enabled) {
            moveFile(storedPath, livePath);
        } else {
            moveFile(livePath, storedPath);
        }
    });
    if (enabled) {
        // Only empty folders are left behind at this point.
        fs.rmSync(disabledPath, { recursive: true, force: true });
    }
    targetMod.enabled = enabled;
    writeModRecords(modRecords);
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

ipcMain.handle('installModFromPath', async (event, zipPath) => {
    const gamePath = store.get('gamePath');
    if (!gamePath) return null;
    const zip = new admZip(zipPath);
    const zipContents = zip.getEntries();
    const stripDepth = getStripDepth(zipContents);
    let lastPercent = -1;
    const installedFiles = await installMod(zipContents, stripDepth, gamePath, (done, total) => {
        const percent = Math.floor(done / total * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        event.sender.send('installProgress', { done, total, percent });
    });
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

ipcMain.handle('setModEnabled', (event, modName, enabled) => {
    const gamePath = store.get('gamePath');
    if (!gamePath) return;
    setModEnabled(modName, gamePath, enabled);
});

app.whenReady().then(() => {
    createWindow();
});