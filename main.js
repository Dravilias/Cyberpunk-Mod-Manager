const { app, BrowserWindow, ipcMain } = require('electron');
const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const gamePath = "D:/SteamLibrary/steamapps/common/Cyberpunk 2077";
const modPath = "C:/Users/kubag/Documents/Mody Cyberpunk/Model 003 Arms -Required Files-23084-1-1-0-1767472183.zip";


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

function listGameFiles() {
    const files = fs.readdirSync(gamePath);
    return files;
}

function inspectModZip() {
    const zip = new admZip(modPath);
    const zipContents = zip.getEntries();
    zipContents.forEach(file => {
        console.log(file.entryName)
    });
}

ipcMain.handle('getGameFiles', () => {
    return listGameFiles();
});

app.whenReady().then(() => {
    createWindow();

});