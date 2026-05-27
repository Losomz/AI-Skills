export const ROOT_SYNC_DIR_EXCLUDES = new Set([
  '.git',
  '.pi',
  '.opencode',
  '.agentframework',
  '.tmp-agentframework',
  '.tmp-bootstrap-src',
  'bin',
  'node_modules',
  'src',
]);

export const CHILD_SYNC_ENTRY_EXCLUDES = new Set(['node_modules', 'README.md']);

export const CONFIG_TITLES = new Map([
  ['.pi', 'Pi 配置'],
  ['.opencode', 'OpenCode 配置'],
]);

export const CONFIG_AFTER_MESSAGES = new Map([
  ['.pi', '请在 Pi 中执行 /reload 重新加载扩展。'],
]);

export function normalizePackageArg(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/\/+$/, '');
}

export function stripLeadingDot(value) {
  return value.replace(/^\.+/, '');
}

export function trimMarkdownExtension(value) {
  return value.replace(/\.md$/i, '');
}

export function isIgnoredRootDir(dirent) {
  return !dirent.isDirectory() || dirent.name.startsWith('.') || ROOT_SYNC_DIR_EXCLUDES.has(dirent.name);
}

export function isIgnoredChildEntry(categoryName, dirent) {
  if (CHILD_SYNC_ENTRY_EXCLUDES.has(dirent.name)) return true;
  if (categoryName !== 'configs' && dirent.name.startsWith('.')) return true;
  return false;
}

export function getCategoryTitle(categoryName) {
  const titles = new Map([
    ['agents', 'Agents 模板'],
    ['configs', '工具配置'],
    ['docs', '文档'],
  ]);
  return titles.get(categoryName) || categoryName;
}

export function getTargetPathForEntry(categoryName, entryName) {
  if (categoryName === 'configs') return entryName;
  return `${categoryName}/${entryName}`;
}

export function getPackageTitle(categoryName, entryName) {
  if (categoryName === 'configs') return CONFIG_TITLES.get(entryName) || `${stripLeadingDot(entryName)} 配置`;
  return `${getCategoryTitle(categoryName)} / ${entryName}`;
}

export function getPackageDescription(categoryName, entryName, targetPath) {
  if (categoryName === 'configs') return `同步 ${entryName} 到 ${targetPath}`;
  return `同步 ${categoryName}/${entryName} 到 ${targetPath}`;
}

export function getCommitScopeForEntry(categoryName, entryName) {
  if (categoryName === 'configs') return stripLeadingDot(entryName);
  return trimMarkdownExtension(entryName);
}
