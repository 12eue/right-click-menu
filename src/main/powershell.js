'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let cachedScript = null;
let helperFile = null;

function getScript() {
  if (cachedScript == null) {
    cachedScript = fs.readFileSync(path.join(__dirname, '..', 'win', 'helpers.ps1'), 'utf8');
  }
  return cachedScript;
}

function getHelperFile() {
  if (helperFile) return helperFile;
  const script = getScript();
  helperFile = path.join(os.tmpdir(), 'rcmm-helpers-' + process.pid + '-' + Date.now() + '.ps1');
  fs.writeFileSync(helperFile, script, 'utf8');
  process.once('exit', () => {
    try {
      fs.unlinkSync(helperFile);
    } catch (_err) {
      // ignore
    }
  });
  return helperFile;
}

function runPs(operation, payload) {
  return new Promise((resolve, reject) => {
    const file = getHelperFile();
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, operation],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        reject(new Error('PowerShell helper failed (' + operation + '): ' + (stderr.trim() || err.message)));
      }
    });
    child.stdin.end(payload == null ? '' : JSON.stringify(payload));
  });
}

async function readKeys(paths) {
  const result = await runPs('read-keys', { paths: Array.isArray(paths) ? paths : [paths] });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || 'read-keys failed');
  }
  return result.result || [];
}

async function deleteEntries(entries) {
  const result = await runPs('delete-entries', { entries });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || 'delete-entries failed');
  }
  return result.result || [];
}

async function isAdmin() {
  const result = await runPs('is-admin', {});
  return !!(result && result.ok && result.result);
}

module.exports = { runPs, readKeys, deleteEntries, isAdmin };
