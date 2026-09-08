'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { deleteEntries } = require('./powershell');

function runReg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (err) => {
      if (err) {
        reject(new Error('reg.exe 返回码 ' + (err.code == null ? err.message : err.code)));
      } else {
        resolve();
      }
    });
  });
}

function sanitizeFileName(name) {
  const cleaned = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80);
  return cleaned || 'menu-item';
}

function pad(value, length) {
  return String(value).padStart(length || 2, '0');
}

function timestamp() {
  const date = new Date();
  return date.getFullYear()
    + pad(date.getMonth() + 1)
    + pad(date.getDate())
    + '-'
    + pad(date.getHours())
    + pad(date.getMinutes())
    + pad(date.getSeconds())
    + '-'
    + pad(date.getMilliseconds(), 3);
}

async function createBackup(entry, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const regPath = (entry.hiveName === 'HKEY_CURRENT_USER' ? 'HKCU\\' : 'HKLM\\') + entry.relativePath;
  const file = path.join(backupDir, timestamp() + '-' + sanitizeFileName(entry.displayName) + '.reg');
  await runReg(['export', regPath, file, '/y']);
  return file;
}

async function deleteItems(entries, backupDir) {
  let okCount = 0;
  const errors = [];
  for (const entry of entries) {
    const sources = entry.sources && entry.sources.length ? entry.sources : [entry];
    try {
      for (const source of sources) {
        await createBackup(source, backupDir);
      }
      const payload = sources.map((source) => ({
        hiveName: source.hiveName,
        relativePath: source.relativePath,
        isSubKey: source.isSubKey,
        valueName: source.valueName || ''
      }));
      const results = await deleteEntries(payload);
      const failed = results.filter((result) => !result.ok);
      if (failed.length) {
        throw new Error(failed.map((result) => result.error).join('；'));
      }
      okCount++;
    } catch (err) {
      errors.push(entry.displayName + '：' + (err.message || String(err)));
    }
  }
  return { okCount, failed: errors.length, errors };
}

async function importReg(file) {
  await runReg(['import', file]);
}

function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.toLowerCase().endsWith('.reg'))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { name, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

module.exports = { deleteItems, importReg, listBackups };
