'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { SCOPES, scanScope } = require('./src/main/scanner');
const { deleteItems, importReg, listBackups } = require('./src/main/backups');
const { isAdmin } = require('./src/main/powershell');

let mainWindow = null;

function backupDir() {
  if (process.env.RCMM_BACKUP_DIR) return process.env.RCMM_BACKUP_DIR;
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'backups');
  }
  return path.join(__dirname, 'backups');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.local.rightclickmenumanager');
    createWindow();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    title: '右键菜单管理器',
    icon: path.join(__dirname, 'src', 'App.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('app:get-info', async () => ({
  version: app.getVersion(),
  isAdmin: await isAdmin().catch(() => false),
  backupDir: backupDir(),
  exePath: process.execPath,
  platform: process.platform
}));

ipcMain.handle('app:get-scopes', () => SCOPES);

ipcMain.handle('app:scan', async (_event, scope) => {
  try {
    const items = await scanScope(scope);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('items:delete', async (_event, entries) => {
  try {
    const result = await deleteItems(entries, backupDir());
    return Object.assign({ ok: true }, result);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('backups:list', async () => listBackups(backupDir()));

ipcMain.handle('backups:import', async (_event, name) => {
  const file = path.join(backupDir(), name);
  try {
    await importReg(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('backups:open', async () => {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

ipcMain.handle('backups:restore', async () => {
  const dir = backupDir();
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: dir,
    title: '选择要恢复的备份',
    filters: [
      { name: '注册表备份', extensions: ['reg'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  const file = result.filePaths[0];
  try {
    await importReg(file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, file, error: err.message || String(err) };
  }
});
