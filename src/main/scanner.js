'use strict';

const fs = require('fs');
const { runPs, readKeys } = require('./powershell');
const {
  friendlyClsidName,
  friendlyVerbName,
  packagedDisplayName,
  packagedHasSubmenu,
  normalizeClsid
} = require('./friendly');

const HKCU = 'HKEY_CURRENT_USER';
const HKLM = 'HKEY_LOCAL_MACHINE';
const HKCR = 'HKEY_CLASSES_ROOT';

const SCOPES = [
  { label: '桌面空白处（DesktopBackground）', classPaths: ['DesktopBackground', 'Directory\\Background'] },
  { label: '文件夹背景（Directory\\Background）', classPaths: ['Directory\\Background'] },
  { label: '文件夹（Directory）', classPaths: ['Directory', 'Folder', 'AllFilesystemObjects'] },
  { label: '所有文件/文件夹（AllFilesystemObjects）', classPaths: ['AllFilesystemObjects', '*'] },
  { label: '驱动器（Drive）', classPaths: ['Drive', 'Directory', 'Folder', 'AllFilesystemObjects', '*'] },
  { label: '所有对象（*）', classPaths: ['*', 'AllFilesystemObjects'] },
  { label: '库（LibraryFolder）', classPaths: ['LibraryFolder', 'Folder', 'AllFilesystemObjects', '*'] },
  { label: '图片（常见格式）', classPaths: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'] },
  { label: '图片（.jpg）', classPaths: ['.jpg'] },
  { label: 'PNG 图片（.png）', classPaths: ['.png'] },
  { label: 'GIF 图片（.gif）', classPaths: ['.gif'] },
  { label: '视频（.mp4）', classPaths: ['.mp4'] },
  { label: '音频（.mp3）', classPaths: ['.mp3'] },
  { label: 'ZIP 压缩文件（.zip）', classPaths: ['.zip'] },
  { label: 'RAR 压缩文件（.rar）', classPaths: ['.rar'] },
  { label: 'PDF 文档（.pdf）', classPaths: ['.pdf'] },
  { label: 'Word 文档（.docx）', classPaths: ['.docx'] },
  { label: 'Excel 工作簿（.xlsx）', classPaths: ['.xlsx'] },
  { label: '文本文件（.txt）', classPaths: ['.txt'] },
  { label: '可执行文件（.exe）', classPaths: ['.exe'] }
];

function getValue(keyResult, name) {
  if (!keyResult || !Array.isArray(keyResult.values)) return null;
  const found = keyResult.values.find((v) => String(v.name) === name);
  return found ? found.data : null;
}

function getString(keyResult, name) {
  const value = getValue(keyResult, name);
  return value == null ? '' : String(value);
}

function hasValue(keyResult, name) {
  return getValue(keyResult, name) != null;
}

function readInt(keyResult, name) {
  const value = Number(getValue(keyResult, name));
  return Number.isFinite(value) ? value : 0;
}

function looksLikeGuid(text) {
  if (!text) return false;
  const trimmed = String(text).trim().replace(/^{|}$/g, '');
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed);
}

function expandEnv(value) {
  return String(value || '').replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
}

function normalizeWindowsPath(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function extractExePath(command) {
  if (!command) return '';
  const cmd = String(command).trim();
  if (!cmd) return '';
  if (cmd[0] === '"') {
    const end = cmd.indexOf('"', 1);
    return end > 0 ? cmd.slice(1, end) : cmd.slice(1);
  }
  const space = cmd.indexOf(' ');
  if (space <= 0) return cmd;
  if (fs.existsSync(cmd)) return cmd;
  const firstSpace = space;
  let cursor = space;
  while (cursor > 0) {
    const candidate = cmd.slice(0, cursor);
    if (fs.existsSync(candidate)) return candidate;
    cursor = cmd.lastIndexOf(' ', cursor - 1);
  }
  return cmd.slice(0, firstSpace);
}

function resolveDisplay(raw, fallback, indirectMap) {
  if (!raw) return fallback;
  const value = String(raw).trim();
  if (value.startsWith('@')) {
    const resolved = indirectMap.get(value);
    return resolved ? String(resolved).trim() : fallback;
  }
  if (value && value !== '@') return value;
  return fallback;
}

function getFileInfo(path, fileInfoMap) {
  return fileInfoMap.get(normalizeWindowsPath(path));
}

function isSystemSource(sourcePath, fileInfoMap, windowsDir) {
  if (!sourcePath) return false;
  const fullPath = expandEnv(sourcePath);
  if (!normalizeWindowsPath(fullPath).startsWith(normalizeWindowsPath(windowsDir))) return false;
  const info = getFileInfo(fullPath, fileInfoMap);
  if (!info || !info.company) return true;
  return String(info.company).toLowerCase().indexOf('microsoft') >= 0;
}

async function resolveIndirectValues(values) {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await runPs('resolve-indirect', { values: unique });
  const map = new Map();
  if (result && result.ok) {
    for (const item of result.result || []) {
      map.set(item.source, item.value);
    }
  }
  return map;
}

async function loadFileInfo(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const result = await runPs('file-info', { paths: unique });
  if (result && result.ok) {
    for (const item of result.result || []) {
      map.set(normalizeWindowsPath(item.path), item);
      if (item.fullPath) map.set(normalizeWindowsPath(item.fullPath), item);
    }
  }
  return map;
}

async function scanSection(classPath, section, items, ctx) {
  const relative = classPath + '\\' + section;
  const roots = [
    { prefix: 'SOFTWARE\\Classes', hive: HKLM, location: '所有用户' },
    { prefix: 'Software\\Classes', hive: HKCU, location: '当前用户' }
  ];
  const paths = roots.map((root) => root.hive + '\\' + root.prefix + '\\' + relative);
  const sectionResults = await readKeys(paths);
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    const sectionRes = sectionResults[i];
    if (!sectionRes || !sectionRes.ok) continue;
    const subNames = sectionRes.subKeys || [];
    if (section === 'shell') {
      await processShellSection(subNames, root, relative, items, ctx);
    } else {
      await processHandlerSection(sectionRes, subNames, root, relative, items, ctx);
    }
  }
}

async function processShellSection(subNames, root, relative, items, ctx) {
  if (!subNames.length) return;
  const verbPaths = subNames.map((name) => root.hive + '\\' + root.prefix + '\\' + relative + '\\' + name);
  const commandPaths = subNames.map((name, i) => verbPaths[i] + '\\command');
  const results = await readKeys(verbPaths.concat(commandPaths));
  const verbResults = results.slice(0, subNames.length);
  const commandResults = results.slice(subNames.length);

  for (let i = 0; i < subNames.length; i++) {
    const verbName = subNames[i];
    const verbRes = verbResults[i];
    if (!verbRes || !verbRes.ok) continue;
    const defaultText = getString(verbRes, '');
    const muiverb = getString(verbRes, 'MUIVerb');
    const rawDisplay = muiverb || defaultText;
    const command = commandResults[i] ? getString(commandResults[i], '') : '';
    const delegate = getString(verbRes, 'DelegateExecute');
    let fullCommand = '';
    if (command) fullCommand = expandEnv(command);
    else if (delegate) fullCommand = 'DelegateExecute: ' + delegate;
    const sourcePath = extractExePath(fullCommand);
    if (sourcePath) ctx.filePaths.add(sourcePath);
    if (rawDisplay && rawDisplay.startsWith('@')) ctx.indirect.add(rawDisplay);

    const flagList = [];
    if (hasValue(verbRes, 'Extended')) flagList.push('Shift+右键可见');
    if (hasValue(verbRes, 'ProgrammaticAccessOnly')) flagList.push('仅程序调用');
    if (readInt(verbRes, 'LegacyDisable') !== 0) flagList.push('已禁用');
    const hasSubmenu = hasValue(verbRes, 'SubCommands') || hasValue(verbRes, 'ExtendedSubCommandsKey');
    if (hasSubmenu) flagList.push('含二级菜单');

    items.push({
      displayName: '',
      rawDisplay: rawDisplay || '',
      rawFallback: verbName,
      kind: 'Shell 命令',
      sourceKind: '',
      locationKind: root.location,
      registryPath: root.hive + '\\' + root.prefix + '\\' + relative + '\\' + verbName,
      relativePath: root.prefix + '\\' + relative + '\\' + verbName,
      hiveName: root.hive,
      command: fullCommand,
      sourcePath,
      flags: '',
      flagList,
      isDisabled: readInt(verbRes, 'LegacyDisable') !== 0,
      isProgrammaticOnly: hasValue(verbRes, 'ProgrammaticAccessOnly'),
      isSubKey: true,
      valueName: '',
      clsid: '',
      packageName: '',
      verbId: '',
      canDelete: true,
      hasSubmenu,
      sources: [],
      useFileDescription: false
    });
  }
}

async function processHandlerSection(sectionRes, subNames, root, relative, items, ctx) {
  const descriptors = [];
  const handlerPaths = [];
  for (const name of subNames) {
    const fullPath = root.hive + '\\' + root.prefix + '\\' + relative + '\\' + name;
    handlerPaths.push(fullPath);
    descriptors.push({
      name,
      fullPath,
      relativePath: root.prefix + '\\' + relative + '\\' + name,
      isSubKey: true,
      valueName: ''
    });
  }
  const valueNames = (sectionRes.values || []).map((v) => String(v.name)).filter((n) => n);
  for (const valueName of valueNames) {
    if (subNames.some((s) => s.toLowerCase() === valueName.toLowerCase())) continue;
    descriptors.push({
      name: valueName,
      fullPath: root.hive + '\\' + root.prefix + '\\' + relative,
      relativePath: root.prefix + '\\' + relative,
      isSubKey: false,
      valueName,
      valueData: getString(sectionRes, valueName)
    });
  }
  if (!descriptors.length) return;

  const handlerResults = await readKeys(handlerPaths);
  const handlerByPath = new Map(handlerResults.map((r) => [r.path.toLowerCase(), r]));
  const clsids = [];

  for (const descriptor of descriptors) {
    if (descriptor.isSubKey) {
      const keyRes = handlerByPath.get(descriptor.fullPath.toLowerCase());
      descriptor.defaultText = getString(keyRes, '');
      descriptor.rawDisplay = !descriptor.defaultText || looksLikeGuid(descriptor.defaultText) ? '' : descriptor.defaultText;
      descriptor.rawFallback = descriptor.name;
      descriptor.clsid = looksLikeGuid(descriptor.defaultText)
        ? descriptor.defaultText
        : (looksLikeGuid(descriptor.name) ? descriptor.name : '');
    } else {
      descriptor.rawDisplay = !descriptor.valueData || looksLikeGuid(descriptor.valueData) ? '' : descriptor.valueData;
      descriptor.rawFallback = descriptor.valueName;
      descriptor.clsid = looksLikeGuid(descriptor.valueName)
        ? descriptor.valueName
        : (looksLikeGuid(descriptor.valueData) ? descriptor.valueData : '');
    }
    if (descriptor.rawDisplay && descriptor.rawDisplay.startsWith('@')) ctx.indirect.add(descriptor.rawDisplay);
    if (descriptor.clsid && !clsids.includes(descriptor.clsid.toUpperCase())) {
      clsids.push(descriptor.clsid.toUpperCase());
    }
  }

  const clsidPaths = [];
  for (const clsid of clsids) {
    const base = HKCR + '\\CLSID\\' + normalizeClsid(clsid);
    clsidPaths.push(base, base + '\\InprocServer32', base + '\\LocalServer32');
  }
  const clsidResults = clsidPaths.length ? await readKeys(clsidPaths) : [];
  const clsidByPath = new Map(clsidResults.map((r) => [r.path.toLowerCase(), r]));
  const clsidInfo = new Map();
  for (let i = 0; i < clsids.length; i++) {
    const clsid = clsids[i];
    const base = (HKCR + '\\CLSID\\' + normalizeClsid(clsid)).toLowerCase();
    const desc = getString(clsidByPath.get(base), '');
    const inproc = getString(clsidByPath.get(base + '\\inprocserver32'), '');
    const local = getString(clsidByPath.get(base + '\\localserver32'), '');
    if (desc && desc.startsWith('@')) ctx.indirect.add(desc);
    clsidInfo.set(clsid, { desc, server: inproc || local });
  }

  for (const descriptor of descriptors) {
    let sourcePath = '';
    let fallbackDisplay = '';
    if (descriptor.clsid) {
      const info = clsidInfo.get(descriptor.clsid.toUpperCase()) || { desc: '', server: '' };
      fallbackDisplay = friendlyClsidName(descriptor.clsid) || '';
      if (info.server) {
        const expanded = expandEnv(info.server);
        sourcePath = extractExePath(expanded);
        if (sourcePath) ctx.filePaths.add(sourcePath);
      }
    }
    const disabled = descriptor.isSubKey
      ? readInt(handlerByPath.get(descriptor.fullPath.toLowerCase()), 'LegacyDisable') !== 0
      : false;
    const flagList = disabled ? ['已禁用'] : [];

    items.push({
      displayName: '',
      rawDisplay: descriptor.rawDisplay || '',
      rawFallback: fallbackDisplay || descriptor.rawFallback,
      kind: 'Shell 扩展',
      sourceKind: '',
      locationKind: root.location,
      registryPath: descriptor.fullPath + (descriptor.valueName ? ' -> ' + descriptor.valueName : ''),
      relativePath: descriptor.relativePath,
      hiveName: root.hive,
      command: sourcePath || '（未解析）',
      sourcePath,
      flags: '',
      flagList,
      isDisabled: disabled,
      isProgrammaticOnly: false,
      isSubKey: descriptor.isSubKey,
      valueName: descriptor.valueName || '',
      clsid: descriptor.clsid || '',
      packageName: '',
      verbId: '',
      canDelete: true,
      hasSubmenu: false,
      sources: [],
      useFileDescription: !!descriptor.clsid
    });
  }
}

async function finalizeEntries(items, ctx) {
  if (ctx.indirect.size) {
    ctx.indirectMap = await resolveIndirectValues([...ctx.indirect]);
  }
  if (ctx.filePaths.size) {
    ctx.fileInfoMap = await loadFileInfo([...ctx.filePaths]);
  }
  for (const entry of items) {
    let displayName = resolveDisplay(entry.rawDisplay, entry.rawFallback, ctx.indirectMap);
    if (entry.kind === 'Shell 命令' && String(displayName).toLowerCase() === String(entry.rawFallback).toLowerCase()) {
      displayName = friendlyVerbName(entry.rawFallback);
    }
    if (entry.useFileDescription && (looksLikeGuid(displayName) || !displayName)) {
      const info = getFileInfo(entry.sourcePath, ctx.fileInfoMap);
      if (info && info.description) displayName = String(info.description).trim();
    }
    entry.displayName = displayName;
    entry.sourceKind = isSystemSource(entry.sourcePath, ctx.fileInfoMap, ctx.windowsDir)
      ? '系统'
      : (entry.sourcePath ? '第三方' : '未知');
    entry.flags = (entry.flagList || []).join('；');
    delete entry.rawDisplay;
    delete entry.rawFallback;
    delete entry.flagList;
    delete entry.useFileDescription;
  }
}

function packagedTypeApplies(itemType, scope) {
  if (!itemType) return false;
  const classPaths = scope.classPaths || [];
  const type = String(itemType).toLowerCase();
  const hasExtension = classPaths.some((p) => p.startsWith('.'));
  if (hasExtension) {
    return classPaths.some((p) => p.startsWith('.') && p.toLowerCase() === type) || type === '*';
  }
  if (type === 'directory\\background') {
    return classPaths.some((p) => p.toLowerCase() === 'desktopbackground' || p.toLowerCase() === 'directory\\background');
  }
  let includesFolders = false;
  let includesFiles = false;
  for (const classPath of classPaths) {
    if (classPath === 'Directory' || classPath === 'Folder' || classPath === 'AllFilesystemObjects') {
      includesFolders = true;
    }
    if (classPath === '*') includesFiles = true;
  }
  if (type === '*') return includesFiles;
  if (type === 'directory' || type === 'folder' || type === 'allfilesystemobjects') return includesFolders;
  return false;
}

let packagedMenusCache = null;

async function getPackagedMenus() {
  if (!packagedMenusCache) {
    const result = await runPs('scan-appx', {});
    packagedMenusCache = result && result.ok ? (result.result || []) : [];
  }
  return packagedMenusCache;
}

async function addPackagedEntries(scope, items) {
  const menus = await getPackagedMenus();
  const added = new Set();
  for (const menu of menus) {
    if (!packagedTypeApplies(menu.itemType, scope)) continue;
    const key = String(menu.packageName) + '|' + String(menu.verbId);
    if (added.has(key.toLowerCase())) continue;
    added.add(key.toLowerCase());
    const hasSubmenu = packagedHasSubmenu(menu.packageName, menu.verbId);
    const flagList = ['应用包扩展'];
    if (hasSubmenu) flagList.push('含二级菜单');
    items.push({
      displayName: packagedDisplayName(menu.packageName, menu.verbId, menu.packageDisplayName),
      kind: '应用扩展',
      sourceKind: '应用包',
      locationKind: '新版菜单',
      registryPath: '应用包：' + menu.packageName,
      relativePath: '',
      hiveName: '',
      command: menu.dllPath || menu.clsid || '',
      sourcePath: menu.dllPath || '',
      flags: flagList.join('；'),
      isDisabled: false,
      isProgrammaticOnly: false,
      isSubKey: false,
      valueName: '',
      clsid: menu.clsid || '',
      packageName: menu.packageName,
      verbId: menu.verbId,
      canDelete: false,
      hasSubmenu,
      sources: []
    });
  }
}

function identityKey(item) {
  if (item.kind === '应用扩展') {
    return 'P|' + item.packageName + '|' + (item.clsid || item.verbId) + '|' + item.displayName;
  }
  if (item.kind === 'Shell 命令') {
    return 'V|' + item.displayName + '|' + item.command;
  }
  if (item.kind === 'Shell 扩展') {
    return 'H|' + item.displayName + '|' + item.clsid + '|' + item.sourcePath;
  }
  return '';
}

function plainSource(item) {
  const copy = Object.assign({}, item);
  delete copy.sources;
  return copy;
}

function mergeEntry(existing, item) {
  if (!existing.sources || !existing.sources.length) {
    existing.sources = [plainSource(existing)];
  }
  const sources = item.sources && item.sources.length ? item.sources.map(plainSource) : [plainSource(item)];
  for (const source of sources) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  }
  if (item.hasSubmenu) existing.hasSubmenu = true;
}

function dedupe(items) {
  const result = [];
  const map = new Map();
  for (const item of items) {
    const key = identityKey(item);
    if (!key) {
      result.push(item);
      continue;
    }
    const existing = map.get(key);
    if (existing) {
      mergeEntry(existing, item);
    } else {
      map.set(key, item);
      result.push(item);
    }
  }

  const byName = new Map();
  const grouped = [];
  for (const item of result) {
    if (item.kind !== 'Shell 扩展') {
      grouped.push(item);
      continue;
    }
    const nameKey = 'X|' + item.displayName + '|' + (item.sourceKind === '系统' ? '' : item.sourcePath);
    const existing = byName.get(nameKey);
    if (existing) {
      mergeEntry(existing, item);
    } else {
      byName.set(nameKey, item);
      grouped.push(item);
    }
  }
  return grouped;
}

async function scanClass(classPath, items, ctx) {
  await scanSection(classPath, 'shell', items, ctx);
  await scanSection(classPath, 'shellex\\ContextMenuHandlers', items, ctx);
}

async function scanClassWithExtras(classPath, items, ctx) {
  const key = classPath.toLowerCase();
  if (ctx.scanned.has(key)) return;
  ctx.scanned.add(key);
  await scanClass(classPath, items, ctx);
  if (!classPath.startsWith('.')) return;

  const sfa = 'SystemFileAssociations\\' + classPath;
  if (!ctx.scanned.has(sfa.toLowerCase())) {
    ctx.scanned.add(sfa.toLowerCase());
    await scanClass(sfa, items, ctx);
  }
  ctx.extensionPaths.push(HKCR + '\\' + classPath);
}

async function scanScope(scope) {
  const items = [];
  const ctx = {
    scanned: new Set(),
    extensionPaths: [],
    indirect: new Set(),
    indirectMap: new Map(),
    filePaths: new Set(),
    fileInfoMap: new Map(),
    windowsDir: process.env.windir || 'C:\\Windows'
  };

  for (const classPath of scope.classPaths || []) {
    await scanClassWithExtras(classPath, items, ctx);
  }

  const extensionPaths = [...new Set(ctx.extensionPaths)];
  if (extensionPaths.length) {
    const extensionResults = await readKeys(extensionPaths);
    for (let i = 0; i < extensionResults.length; i++) {
      const extensionRes = extensionResults[i];
      if (!extensionRes || !extensionRes.ok) continue;
      const extension = extensionPaths[i].split('\\').pop();
      const progId = getString(extensionRes, '');
      if (progId && progId.toLowerCase() !== extension.toLowerCase() && !ctx.scanned.has(progId.toLowerCase())) {
        ctx.scanned.add(progId.toLowerCase());
        await scanClass(progId, items, ctx);
      }
    }
  }

  await finalizeEntries(items, ctx);
  await addPackagedEntries(scope, items);
  const deduped = dedupe(items);
  deduped.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'zh-CN', {
    sensitivity: 'base',
    numeric: true
  }));
  return deduped.map((item, index) => Object.assign({ id: 'item-' + index }, item));
}

module.exports = { SCOPES, scanScope };
