const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const admZip = require('adm-zip');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const Store = require('electron-store');

// Keep the data folder from before productName was set, so the saved game path survives.
app.setPath('userData', path.join(app.getPath('appData'), 'cyberpunk-mod-manager'));

const store = new Store();
const rootFolders = ["archive", "r6", "bin", "engine", "red4ext", "mods"];
const modsDbPath = path.join(app.getPath('userData'), 'mods.json');
const disabledFolderName = '.cmm-disabled';
const nexusGame = 'cyberpunk2077';

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

function extractWithSevenZip(archivePath, outputPath) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'extractWorker.js'), {
            workerData: { archivePath, outputPath }
        });
        worker.once('message', result => result.ok ? resolve() : reject(new Error(result.error)));
        worker.once('error', reject);
        worker.once('exit', code => reject(new Error(`Extraction stopped unexpectedly (code ${code}).`)));
    });
}

function listFilesRecursive(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(item => {
        const fullPath = path.join(folder, item.name);
        return item.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
    });
}

// Returns { entries, cleanup } where entries look like adm-zip entries
// ({ entryName, isDirectory, getData() }), whatever the archive format.
async function openArchive(archivePath, onExtracting) {
    if (path.extname(archivePath).toLowerCase() === '.zip') {
        return { entries: new admZip(archivePath).getEntries(), cleanup: () => {} };
    }

    // .7z and .rar are unpacked to a temp folder first, then installed like a zip.
    onExtracting();
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cmm-extract-'));
    const cleanup = () => fs.rmSync(tempPath, { recursive: true, force: true });
    try {
        await extractWithSevenZip(archivePath, tempPath);
    } catch (error) {
        cleanup();
        throw error;
    }
    const entries = listFilesRecursive(tempPath).map(fullPath => ({
        entryName: path.relative(tempPath, fullPath).split(path.sep).join('/'),
        isDirectory: false,
        getData: () => fs.readFileSync(fullPath)
    }));
    return { entries, cleanup };
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

// Nexus downloads are named "<name>-<mod id>-<version>-<upload timestamp>",
// e.g. "ArchiveXL-4198-1-21-0-1735000000" for version 1.21.0.
function parseNexusFileName(rawName) {
    const match = rawName.match(/^(.+?)-(\d+)-(.+)-(\d{9,11})$/);
    if (!match) return null;
    return {
        modId: Number(match[2]),
        version: match[3].replace(/-/g, '.'),
        uploadedTimestamp: Number(match[4])
    };
}

// Reinstalling a mod replaces its record, so each name appears once.
function saveModRecord(modName, installedFiles, nexusInfo, enabled) {
    const json = readModRecords();
    const record = {
        name: modName,
        installDate: new Date().toISOString(),
        enabled: enabled,
        files: installedFiles
    }
    if (nexusInfo) {
        record.nexus = nexusInfo;
    }
    const existingIndex = json.findIndex(modRecord => modRecord.name === modName);
    if (existingIndex === -1) {
        json.push(record);
    } else {
        json[existingIndex] = record;
    }
    writeModRecords(json);
}

// Finds the installed mod a new archive replaces. Two Nexus mods with different ids that
// happen to share a name are different mods, so the new one gets "Name (2)" instead.
function findModToReplace(modRecords, modName, nexusInfo) {
    let candidate = modName;
    for (let n = 2; ; n++) {
        const existing = modRecords.find(modRecord => modRecord.name === candidate);
        if (!existing) return { existing: null, name: candidate };
        const differentNexusMod = existing.nexus && nexusInfo && existing.nexus.modId !== nexusInfo.modId;
        if (!differentNexusMod) return { existing, name: candidate };
        candidate = `${modName} (${n})`;
    }
}

function removeFiles(root, files) {
    files.forEach(file => {
        const fullPath = path.join(root, file);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    });
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

function getNexusModUrl(modId) {
    return `https://www.nexusmods.com/${nexusGame}/mods/${modId}?tab=files`;
}

async function fetchNexusModFiles(modId, apiKey) {
    const response = await fetch(`https://api.nexusmods.com/v1/games/${nexusGame}/mods/${modId}/files.json`, {
        headers: {
            'apikey': apiKey,
            'Application-Name': 'Cyberpunk Mod Manager',
            'Application-Version': app.getVersion()
        }
    });
    if (response.status === 401) throw new Error('Nexus rejected the API key.');
    if (response.status === 429) throw new Error('Nexus rate limit reached, try again later.');
    if (response.status === 404) return null; // mod removed or hidden
    if (!response.ok) throw new Error(`Nexus returned ${response.status}.`);
    return response.json();
}

// Returns the newer file that replaced the installed one, or null if it is current.
function findNewerFile(nexusFiles, nexusInfo) {
    const installedFile = nexusFiles.files.find(file => file.uploaded_timestamp === nexusInfo.uploadedTimestamp);
    if (!installedFile) return null;

    // Nexus records "old file -> new file" whenever an author uploads an update; follow the chain.
    let current = installedFile;
    const seen = new Set();
    while (!seen.has(current.file_id)) {
        seen.add(current.file_id);
        const update = nexusFiles.file_updates.find(u => u.old_file_id === current.file_id);
        const next = update && nexusFiles.files.find(file => file.file_id === update.new_file_id);
        if (!next) break;
        current = next;
    }
    if (current !== installedFile) return current;

    // Author archived the file without linking a replacement; point at the newest main file.
    if (['OLD_VERSION', 'ARCHIVED'].includes(installedFile.category_name)) {
        const mainFiles = nexusFiles.files.filter(file => file.category_name === 'MAIN');
        mainFiles.sort((a, b) => b.uploaded_timestamp - a.uploaded_timestamp);
        return mainFiles[0] || installedFile;
    }
    return null;
}

async function checkModUpdates(apiKey) {
    const trackedMods = readModRecords().filter(record => record.nexus);
    const updates = {};
    for (const record of trackedMods) {
        const nexusFiles = await fetchNexusModFiles(record.nexus.modId, apiKey);
        if (!nexusFiles) continue;
        const newerFile = findNewerFile(nexusFiles, record.nexus);
        if (newerFile) {
            updates[record.name] = {
                version: newerFile.version || null,
                url: getNexusModUrl(record.nexus.modId)
            };
        }
    }
    return { checked: trackedMods.length, updates };
}

ipcMain.handle('getNexusApiKey', () => store.get('nexusApiKey', ''));

ipcMain.handle('setNexusApiKey', (event, apiKey) => {
    store.set('nexusApiKey', apiKey.trim());
});

ipcMain.handle('checkModUpdates', async () => {
    const apiKey = store.get('nexusApiKey', '');
    if (!apiKey) return { error: 'Add your Nexus API key first.' };
    try {
        return await checkModUpdates(apiKey);
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('openModPage', (event, modName) => {
    const record = readModRecords().find(modRecord => modRecord.name === modName);
    if (record && record.nexus) {
        shell.openExternal(getNexusModUrl(record.nexus.modId));
    }
});

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
        filters: [{ name: 'Mod Archives', extensions: ['zip', '7z', 'rar'] }]
    });
    if (!result) {
        return null
    };
    return result;
})

ipcMain.handle('installModFromPath', async (event, zipPath) => {
    const gamePath = store.get('gamePath');
    if (!gamePath) return null;
    const rawName = path.basename(zipPath, path.extname(zipPath))
    const cleanName = rawName.replace(/-\d.*$/, '')
    const nexusInfo = parseNexusFileName(rawName);
    const { existing, name } = findModToReplace(readModRecords(), cleanName, nexusInfo);

    let keepDisabled = false;
    if (existing && !isEnabled(existing)) {
        const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
            type: 'question',
            buttons: ['Enable it', 'Keep it disabled'],
            defaultId: 0,
            cancelId: 1,
            message: `"${name}" is currently disabled.`,
            detail: 'Should the new version be enabled, or installed but kept disabled?'
        });
        keepDisabled = response === 1;
    }
    const disabledPath = getDisabledModPath(gamePath, name);
    // A mod that stays disabled is installed straight into its disabled storage folder.
    const installRoot = keepDisabled ? disabledPath : gamePath;

    const archive = await openArchive(zipPath, () => {
        event.sender.send('installProgress', { extracting: true });
    });
    let installedFiles;
    try {
        const stripDepth = getStripDepth(archive.entries);
        let lastPercent = -1;
        installedFiles = await installMod(archive.entries, stripDepth, installRoot, (done, total) => {
            const percent = Math.floor(done / total * 100);
            if (percent === lastPercent) return;
            lastPercent = percent;
            event.sender.send('installProgress', { done, total, percent });
        });
    } finally {
        archive.cleanup();
    }

    // Clean up whatever the previous version left that the new one no longer ships.
    if (existing) {
        const staleFiles = existing.files.filter(file => !installedFiles.includes(file));
        if (isEnabled(existing)) {
            removeFiles(gamePath, staleFiles);
        } else if (keepDisabled) {
            removeFiles(disabledPath, staleFiles);
        } else {
            fs.rmSync(disabledPath, { recursive: true, force: true });
        }
    }
    saveModRecord(name, installedFiles, nexusInfo, !keepDisabled);
    return name;
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