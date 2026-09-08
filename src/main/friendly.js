'use strict';

const CLSID_NAMES = {
  '{CB3D0F55-BC2C-4C1A-85ED-23ED75B5106B}': 'OneDrive',
  '{A470F8CF-A1E8-4F65-8335-227475AA5C46}': '加密',
  '{474C98EE-CF3D-41F5-80E3-4AAB0AB04301}': '脱机文件',
  '{7C0F6D57-E799-4C8A-A319-8E2B4D724CF0}': '360安全卫士',
  '{086F171D-5ED1-4ED2-B736-CFF3AD6A128E}': '360安全卫士',
  '{F81E9010-6EA4-11CE-A7FF-00AA003CA9F6}': '共享',
  '{E61BF828-5E63-4287-BEF1-60B1A4FDE0E3}': '工作文件夹',
  '{A2A9545D-A0C2-42B4-9708-A0B2BADD77C8}': '固定到“开始”屏幕',
  '{90AA3A4E-1CBA-4233-B8BB-535773D48449}': '固定到任务栏',
  '{470C0EBD-5D73-4D58-9CED-E91E22E23282}': '固定到“开始”屏幕',
  '{3DAD6C5D-2167-4CAE-9914-F99E41C12CFA}': '库',
  '{09799AFB-AD67-11D1-ABCD-00C04FC30936}': '打开方式',
  '{5E19C0CE-C02C-46C2-98C3-A2E12EDE0E17}': '软件管理器',
  '{7BA4C740-9E81-11CF-99D3-00AA004AE837}': '发送到',
  '{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}': '共享',
  '{F3D06E7C-1E45-4A26-847E-F9FCDEE59BE0}': '复制文件路径',
  '{596AB062-B4D2-4215-9F74-E9109B0A8153}': '压缩文件夹',
  '{D6791A63-E7E2-4FEE-BF52-5DED8E86E9B8}': '便携设备',
  '{2854F705-3548-414C-A113-93E27C808C85}': '增强存储',
  '{0BF754AA-C967-445C-AB3D-D8FDA9BAE7EF}': '桌面幻灯片放映',
  '{FFE2A43C-56B9-4BF5-9A79-CC6D4285608A}': '图片预览'
};

const VERB_NAMES = {
  open: '打开',
  explore: '资源管理器',
  find: '搜索',
  printto: '打印到',
  pintohome: '固定到“快速访问”',
  opennewwindow: '在新窗口中打开',
  opennewtab: '在新选项卡中打开',
  opennewprocess: '在新进程中打开',
  cmd: '在此处打开命令窗口',
  powershell: '在此处打开 PowerShell 窗口',
  runas: '以其他用户身份运行',
  properties: '属性',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  delete: '删除',
  rename: '重命名',
  print: '打印'
};

const PACKAGED_NAMES = {
  'QQExtension|QQExtension': '通过QQ发送',
  'PDFShellExt|imageFile': '图片转换',
  'PDFShellExt|officeFile': '转换为 PDF',
  'PDFShellExt|file2': '转换为 PDF',
  'WinRAR.ShellExtension|ATopItemWinRAR': 'WinRAR',
  'Microsoft.Paint|EditInPaint': '使用画图编辑',
  'Microsoft.Windows.Photos|AShellEdit': '使用照片编辑',
  'Microsoft.Windows.Photos|ShellEdit': '使用照片编辑',
  'Microsoft.WindowsNotepad|OpenInNotepad': '使用记事本打开',
  'Microsoft.WindowsTerminal|OpenTerminalHere': '在终端中打开',
  'Microsoft.VisualStudioCode|OpenWithCode': '使用 Code 打开',
  'Clipchamp.Clipchamp|EditWith': '使用 Clipchamp 编辑',
  'Microsoft.MicrosoftOfficeHub|AskM365Copilot': '询问 Copilot',
  'OpenAI.Codex|OpenProjectInCodex': '用 Codex 打开项目',
  'BaiduNetdisk.DesktopSyncClient|File': '发送到百度网盘',
  'BaiduNetdisk.DesktopSyncClient|Directory': '发送到百度网盘',
  'Microsoft.OneDriveSync|Command0': '共享',
  'Microsoft.OneDriveSync|Command1': '在线查看',
  'Microsoft.OneDriveSync|Command2': '始终保留在此设备上',
  'Microsoft.OneDriveSync|Command3': '释放空间',
  'Microsoft.OneDriveSync|Command4': 'OneDrive 其他操作 1',
  'Microsoft.OneDriveSync|Command5': 'OneDrive 其他操作 2'
};

const PACKAGED_SUBMENUS = new Set([
  'WinRAR.ShellExtension|ATopItemWinRAR',
  'QQExtension|QQExtension',
  'PDFShellExt|imageFile'
]);

function friendlyClsidName(clsid) {
  const key = normalizeClsid(clsid).toUpperCase();
  return CLSID_NAMES[key] || '';
}

function friendlyVerbName(verbName) {
  return VERB_NAMES[String(verbName || '').toLowerCase()] || String(verbName || '');
}

function packagedDisplayName(packageName, verbId, packageDisplayName) {
  const base = packageBaseName(packageName);
  const known = PACKAGED_NAMES[base + '|' + verbId];
  if (known) return known;
  const fallback = packageDisplayName || base;
  return fallback + '（应用扩展）';
}

function packagedHasSubmenu(packageName, verbId) {
  return PACKAGED_SUBMENUS.has(packageBaseName(packageName) + '|' + verbId);
}

function packageBaseName(packageName) {
  const index = String(packageName || '').indexOf('_');
  return index > 0 ? packageName.slice(0, index) : String(packageName || '');
}

function normalizeClsid(clsid) {
  const text = String(clsid || '').trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;
  return '{' + text + '}';
}

module.exports = {
  friendlyClsidName,
  friendlyVerbName,
  packagedDisplayName,
  packagedHasSubmenu,
  packageBaseName,
  normalizeClsid
};
