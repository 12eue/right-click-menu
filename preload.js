'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getScopes: () => ipcRenderer.invoke('app:get-scopes'),
  scan: (scope) => ipcRenderer.invoke('app:scan', scope),
  deleteItems: (items) => ipcRenderer.invoke('items:delete', items),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  openBackups: () => ipcRenderer.invoke('backups:open'),
  restoreBackup: () => ipcRenderer.invoke('backups:restore'),
  importBackup: (name) => ipcRenderer.invoke('backups:import', name)
});
