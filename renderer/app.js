'use strict';

const state = {
  scopes: [],
  activeScope: null,
  items: [],
  filtered: [],
  selected: new Set(),
  onlyVisible: true,
  search: '',
  view: 'menus',
  backups: [],
  selectedBackup: null,
  appInfo: null,
  detailsCollapsed: false
};

let pendingConfirm = null;
let toastTimer = null;
let scanRequestId = 0;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function refreshIcons() {
  if (window.lucide && lucide.createIcons) {
    lucide.createIcons();
  }
}

function setTableLoading(loading) {
  const node = $('table-loading');
  if (!node) return;
  node.classList.toggle('hidden', !loading);
  $('table-wrap').setAttribute('aria-busy', loading ? 'true' : 'false');
  if (loading) refreshIcons();
}

function setStatus(message, isError) {
  const node = $('status-message');
  node.textContent = message || '就绪';
  node.style.color = isError ? '#ffd7d7' : '';
}

function showToast(message, type) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden', 'error', 'success');
  if (type === 'error') toast.classList.add('error');
  if (type === 'success') toast.classList.add('success');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

async function init() {
  bindEvents();
  state.appInfo = await window.api.getAppInfo();
  state.scopes = await window.api.getScopes();
  renderScopes();
  renderAbout();
  const defaultScope = state.scopes.find((scope) => scope.label.indexOf('文件夹（Directory）') === 0) || state.scopes[0];
  await selectScope(defaultScope, true);
  refreshIcons();
}

function bindEvents() {
  $('search-input').addEventListener('input', (event) => {
    state.search = event.target.value;
    applyFilter();
    renderTable();
    renderDetails();
    renderStatus();
  });

  $('only-visible').addEventListener('change', (event) => {
    state.onlyVisible = event.target.checked;
    applyFilter();
    renderTable();
    renderDetails();
    renderStatus();
  });

  $('refresh-btn').addEventListener('click', () => selectScope(state.activeScope, false));
  $('custom-scope').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyCustomScope();
  });
  $('custom-scope-btn').addEventListener('click', applyCustomScope);

  $('delete-btn').addEventListener('click', confirmDeleteFlow);
  $('open-backups-btn').addEventListener('click', () => window.api.openBackups());
  $('sidebar-backups-open').addEventListener('click', () => window.api.openBackups());

  $('table-body').addEventListener('click', onTableClick);
  $('select-all').addEventListener('change', (event) => {
    const ids = new Set(state.filtered.map((item) => item.id));
    if (event.target.checked) {
      ids.forEach((id) => state.selected.add(id));
    } else {
      ids.forEach((id) => state.selected.delete(id));
    }
    renderTable();
    renderDetails();
    updateDeleteButton();
  });

  $('collapse-details').addEventListener('click', () => {
    state.detailsCollapsed = !state.detailsCollapsed;
    $('details-panel').classList.toggle('collapsed', state.detailsCollapsed);
  });

  document.querySelectorAll('.activity-btn').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  $('backups-refresh').addEventListener('click', renderBackups);
  $('backups-restore').addEventListener('click', restoreSelectedBackup);
  $('backup-list').addEventListener('click', (event) => {
    const row = event.target.closest('.backup-row');
    if (!row) return;
    state.selectedBackup = row.dataset.name;
    updateBackupSelection();
  });

  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-confirm').addEventListener('click', () => {
    if (pendingConfirm) pendingConfirm();
  });
}

function applyCustomScope() {
  const text = $('custom-scope').value.trim();
  if (!text) return;
  let classPath = text;
  if (classPath !== '*' && classPath.indexOf('.') !== 0) {
    classPath = '.' + classPath;
  }
  selectScope({ label: '自定义：' + text, classPaths: [classPath] }, false);
}

function renderScopes() {
  const groups = [
    { title: '系统位置', scopes: state.scopes.slice(0, 7), icon: 'folder' },
    { title: '常见文件类型', scopes: state.scopes.slice(7), icon: 'file-text' }
  ];
  const activeLabel = state.activeScope ? state.activeScope.label : '';
  const list = $('scope-list');
  list.innerHTML = groups.map((group) => {
    const items = group.scopes.map((scope) => {
      const active = scope.label === activeLabel ? ' active' : '';
      return '<div class="scope-item' + active + '" data-label="' + esc(scope.label) + '">'
        + '<i data-lucide="' + group.icon + '"></i>'
        + '<span class="scope-label">' + esc(scope.label) + '</span>'
        + '</div>';
    }).join('');
    return '<div class="scope-group-title">' + esc(group.title) + '</div>' + items;
  }).join('');

  list.querySelectorAll('.scope-item').forEach((item) => {
    item.addEventListener('click', () => {
      const scope = state.scopes.find((candidate) => candidate.label === item.dataset.label);
      if (scope) selectScope(scope, false);
    });
  });
  refreshIcons();
}

async function selectScope(scope, silent) {
  const requestId = ++scanRequestId;
  state.activeScope = scope;
  state.selected.clear();
  renderScopes();
  setTableLoading(true);
  if (!silent) setStatus('正在扫描…');
  let failed = false;
  try {
    const result = await window.api.scan(scope);
    if (requestId !== scanRequestId) return;
    if (result && result.ok) {
      state.items = result.items || [];
    } else {
      failed = true;
      state.items = [];
      setStatus('扫描失败：' + ((result && result.error) || '未知错误'), true);
    }
    applyFilter();
    renderTable();
    renderDetails();
    renderStatus();
    updateDeleteButton();
  } finally {
    if (requestId === scanRequestId) {
      setTableLoading(false);
      if (!silent && !failed) setStatus('就绪');
    }
  }
}

function applyFilter() {
  const search = state.search.trim().toLowerCase();
  state.filtered = state.items.filter((item) => {
    if (state.onlyVisible && (item.isDisabled || item.isProgrammaticOnly)) return false;
    if (search && String(item.displayName || '').toLowerCase().indexOf(search) < 0) return false;
    return true;
  });
}

function badgeClass(sourceKind) {
  return {
    '系统': 'badge-system',
    '第三方': 'badge-third',
    '应用包': 'badge-package',
    '未知': 'badge-unknown'
  }[sourceKind] || 'badge-unknown';
}

function badgeText(sourceKind) {
  return {
    '系统': '系统',
    '第三方': '第三方',
    '应用包': '应用包',
    '未知': '未知'
  }[sourceKind] || '未知';
}

function renderTable() {
  const body = $('table-body');
  const empty = $('empty-state');
  if (!state.filtered.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    $('select-all').checked = false;
    refreshIcons();
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = state.filtered.map((item) => {
    const selected = state.selected.has(item.id) ? ' selected' : '';
    const dimmed = item.isDisabled || item.isProgrammaticOnly ? ' disabled' : '';
    const flags = item.flags ? '<div class="flag-text">' + esc(item.flags) + '</div>' : '';
    const checked = selected ? ' checked' : '';
    return '<div class="table-row row-item' + selected + dimmed + '" data-id="' + esc(item.id) + '">'
      + '<div class="col-check"><input type="checkbox"' + checked + ' aria-label="选择" /></div>'
      + '<div class="col-name">' + esc(item.displayName) + '</div>'
      + '<div class="col-kind"><div>' + esc(item.kind) + '</div>' + flags + '</div>'
      + '<div class="col-source"><span class="badge ' + badgeClass(item.sourceKind) + '">' + badgeText(item.sourceKind) + '</span></div>'
      + '<div class="col-location">' + esc(item.locationKind) + '</div>'
      + '<div class="col-command" title="' + esc(item.command) + '">' + esc(item.command || '（未解析）') + '</div>'
      + '</div>';
  }).join('');
  $('select-all').checked = state.filtered.length > 0 && state.filtered.every((item) => state.selected.has(item.id));
  refreshIcons();
}

function onTableClick(event) {
  const row = event.target.closest('.row-item');
  if (!row) return;
  const id = row.dataset.id;
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  row.classList.toggle('selected', state.selected.has(id));
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = state.selected.has(id);
  const allVisibleSelected = state.filtered.length > 0 && state.filtered.every((item) => state.selected.has(item.id));
  $('select-all').checked = allVisibleSelected;
  renderDetails();
  updateDeleteButton();
}

function updateDeleteButton() {
  const anyDeletable = state.items.some((item) => state.selected.has(item.id) && item.canDelete);
  $('delete-btn').disabled = !anyDeletable;
}

function renderDetails() {
  const selectedEntries = state.items.filter((item) => state.selected.has(item.id));
  const countNode = $('selection-count');
  const body = $('details-body');
  if (selectedEntries.length === 1) {
    countNode.textContent = '1 项';
    body.innerHTML = detailHtml(selectedEntries[0]);
  } else if (selectedEntries.length > 1) {
    countNode.textContent = selectedEntries.length + ' 项';
    const deletable = selectedEntries.filter((item) => item.canDelete).length;
    let html = '<div class="detail-row"><span class="label">已选择</span><span class="value">' + selectedEntries.length + ' 项，其中 ' + deletable + ' 项可删除。</span></div>';
    html += '<div class="detail-row"><span class="label">备份</span><span class="value">删除前会自动备份到 backups 文件夹。</span></div>';
    if (selectedEntries.length > deletable) {
      html += '<div class="detail-note">另有 ' + (selectedEntries.length - deletable) + ' 项由应用包提供，无法直接删除。</div>';
    }
    body.innerHTML = html;
  } else {
    countNode.textContent = '';
    body.innerHTML = '<div class="detail-row"><span class="label">提示</span><span class="value">从列表中选择一项查看详细信息，勾选多项后可批量删除。</span></div>';
  }
}

function detailHtml(item) {
  let html = '<div class="detail-row"><span class="label">菜单名称</span><span class="value">' + esc(item.displayName) + '</span></div>';
  html += '<div class="detail-row"><span class="label">类型</span><span class="value">' + esc(item.kind) + (item.flags ? '（' + esc(item.flags) + '）' : '') + '</span></div>';
  html += '<div class="detail-row"><span class="label">来源</span><span class="value">' + esc(item.sourceKind) + '</span></div>';
  html += '<div class="detail-row"><span class="label">位置</span><span class="value">' + esc(item.locationKind) + '</span></div>';
  if (item.kind === '应用扩展') {
    html += '<div class="detail-row"><span class="label">应用包</span><span class="value mono">' + esc(item.packageName) + '</span></div>';
  }
  html += '<div class="detail-row"><span class="label">注册表位置</span><span class="value mono">' + esc(item.registryPath) + '</span></div>';
  if (item.sources && item.sources.length > 1) {
    const paths = item.sources.map((source) => '<li>' + esc(source.registryPath) + '</li>').join('');
    html += '<div class="detail-row"><span class="label">已合并 ' + item.sources.length + ' 处</span><ul class="detail-list">' + paths + '</ul></div>';
  }
  if (item.command) {
    html += '<div class="detail-row"><span class="label">命令或处理程序</span><span class="value mono">' + esc(item.command) + '</span></div>';
  }
  if (item.hasSubmenu) {
    html += '<div class="detail-note">该菜单含二级菜单，二级菜单由程序生成，不支持单独删除。</div>';
  }
  if (item.kind === '应用扩展') {
    html += '<div class="detail-note">该菜单由应用包提供，无法通过注册表直接删除；请在对应应用内关闭，或卸载该应用包。</div>';
  }
  return html;
}

function renderStatus() {
  $('status-count').textContent = '共 ' + state.items.length + ' 项 · 显示 ' + state.filtered.length + ' 项';
}

function confirmDeleteFlow() {
  const selectedEntries = state.items.filter((item) => state.selected.has(item.id));
  const deletable = selectedEntries.filter((item) => item.canDelete);
  if (!deletable.length) {
    showToast('所选菜单由应用包提供，无法直接删除。', 'error');
    return;
  }
  const skipped = selectedEntries.length - deletable.length;
  const systemCount = deletable.filter((item) => item.sourceKind === '系统').length;
  let html = '<p>即将删除 ' + deletable.length + ' 个菜单项。</p><p>删除前会自动备份到程序目录下的 backups 文件夹。</p>';
  if (skipped > 0) {
    html += '<p>另有 ' + skipped + ' 项由应用包提供，已跳过，无法直接删除。</p>';
  }
  if (systemCount > 0) {
    html += '<p class="warn">注意：其中 ' + systemCount + ' 个是系统菜单项，删除后可能影响 Windows 功能。</p>';
  }
  openModal({
    title: '确认删除',
    body: html,
    confirmText: '确认删除',
    onConfirm: async () => {
      closeModal();
      setStatus('正在删除并备份…');
      const result = await window.api.deleteItems(deletable);
      if (result && result.ok) {
        if (result.failed > 0) {
          showToast('已删除 ' + result.okCount + ' 项，失败 ' + result.failed + ' 项。', 'error');
        } else {
          showToast('已删除 ' + result.okCount + ' 项，备份已保存。', 'success');
        }
      } else {
        showToast('删除失败：' + ((result && result.error) || '未知错误'), 'error');
      }
      state.selected.clear();
      await selectScope(state.activeScope, true);
      if (state.view === 'backups') await renderBackups();
      setStatus('就绪');
    }
  });
}

function openModal(options) {
  $('modal-title').textContent = options.title;
  $('modal-body').innerHTML = options.body;
  $('modal-confirm').textContent = options.confirmText || '确定';
  pendingConfirm = options.onConfirm;
  $('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  pendingConfirm = null;
  $('modal-overlay').classList.add('hidden');
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.activity-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((node) => {
    node.classList.toggle('active', node.id === view + '-view');
  });
  $('sidebar-menus').classList.toggle('hidden', view !== 'menus');
  $('sidebar-backups').classList.toggle('hidden', view !== 'backups');
  $('sidebar-about').classList.toggle('hidden', view !== 'about');
  if (view === 'backups') renderBackups();
  if (view === 'about') renderAbout();
  refreshIcons();
}

async function renderBackups() {
  state.backups = await window.api.listBackups();
  const list = $('backup-list');
  const empty = $('backup-empty');
  if (!state.backups.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    state.selectedBackup = null;
  } else {
    empty.classList.add('hidden');
    if (!state.selectedBackup || !state.backups.some((backup) => backup.name === state.selectedBackup)) {
      state.selectedBackup = state.backups[0].name;
    }
    list.innerHTML = state.backups.map((backup) => {
      const selected = backup.name === state.selectedBackup ? ' selected' : '';
      return '<div class="backup-row' + selected + '" data-name="' + esc(backup.name) + '">'
        + '<div class="backup-icon"><i data-lucide="file-text"></i></div>'
        + '<div class="backup-name" title="' + esc(backup.name) + '">' + esc(backup.name) + '</div>'
        + '<div class="backup-meta">' + esc(formatDate(backup.mtime)) + '</div>'
        + '<div class="backup-size">' + esc(formatSize(backup.size)) + '</div>'
        + '</div>';
    }).join('');
  }
  updateBackupSelection();
  refreshIcons();
}

function updateBackupSelection() {
  document.querySelectorAll('.backup-row').forEach((row) => {
    row.classList.toggle('selected', row.dataset.name === state.selectedBackup);
  });
  $('backups-restore').disabled = !state.selectedBackup;
  const stats = $('backup-stats');
  if (!state.backups.length) {
    stats.innerHTML = '<div class="stat-row"><strong>0</strong><span>个备份文件</span></div>';
    return;
  }
  const totalSize = state.backups.reduce((sum, backup) => sum + backup.size, 0);
  const newest = state.backups[0];
  stats.innerHTML = '<div class="stat-row"><strong>' + state.backups.length + '</strong><span>个备份文件</span></div>'
    + '<div class="stat-row"><strong>' + esc(formatSize(totalSize)) + '</strong><span>总计</span></div>'
    + '<div class="stat-row"><strong>' + esc(formatDate(newest.mtime)) + '</strong><span>最近备份</span></div>';
}

async function restoreSelectedBackup() {
  if (!state.selectedBackup) return;
  const result = await window.api.importBackup(state.selectedBackup);
  if (result && result.ok) {
    showToast('恢复完成。请刷新或重新打开此工具查看结果。', 'success');
  } else {
    showToast('恢复失败：' + ((result && result.error) || '未知错误'), 'error');
  }
}

function renderAbout() {
  const info = state.appInfo || {};
  $('about-version').textContent = info.version || '-';
  $('about-backup-dir').textContent = info.backupDir || '-';
  $('about-admin').textContent = info.isAdmin ? '管理员' : '普通用户';
  $('about-admin').style.color = info.isAdmin ? '#89d185' : '#cca700';
  const badge = $('status-admin');
  badge.innerHTML = '<i data-lucide="' + (info.isAdmin ? 'shield-check' : 'shield-alert') + '"></i>'
    + (info.isAdmin ? ' 管理员' : ' 普通用户');
  const stats = $('about-stats');
  stats.innerHTML = '<div class="stat-row"><strong>' + esc(info.version || '-') + '</strong><span>版本</span></div>'
    + '<div class="stat-row"><strong>' + (info.isAdmin ? '管理员' : '普通用户') + '</strong><span>权限状态</span></div>'
    + '<div class="stat-row"><strong>' + esc(info.platform || '-') + '</strong><span>平台</span></div>';
  refreshIcons();
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

document.addEventListener('DOMContentLoaded', init);
