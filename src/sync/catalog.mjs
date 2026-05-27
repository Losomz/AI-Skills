import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CONFIG_AFTER_MESSAGES,
  getCommitScopeForEntry,
  getPackageDescription,
  getPackageTitle,
  getTargetPathForEntry,
  isIgnoredChildEntry,
  isIgnoredRootDir,
  normalizePackageArg,
  stripLeadingDot,
  trimMarkdownExtension,
  getCategoryTitle,
} from './rules.mjs';

export function createSyncPackage(categoryName, dirent) {
  const sourcePath = `${categoryName}/${dirent.name}`;
  const targetPath = getTargetPathForEntry(categoryName, dirent.name);
  const baseName = trimMarkdownExtension(dirent.name);
  const aliases = new Set([
    sourcePath,
    targetPath,
    dirent.name,
    baseName,
  ]);

  if (categoryName === 'configs') {
    aliases.add(stripLeadingDot(dirent.name));
    aliases.add(`configs/${stripLeadingDot(dirent.name)}`);
  }

  return {
    name: categoryName === 'configs' ? stripLeadingDot(dirent.name) : baseName,
    key: sourcePath,
    category: categoryName,
    entryName: dirent.name,
    aliases: [...aliases].map(normalizePackageArg),
    title: getPackageTitle(categoryName, dirent.name),
    description: getPackageDescription(categoryName, dirent.name, targetPath),
    commitScope: getCommitScopeForEntry(categoryName, dirent.name),
    targets: [
      {
        from: sourcePath,
        to: targetPath,
        after: CONFIG_AFTER_MESSAGES.get(dirent.name),
      },
    ],
  };
}

export async function buildSyncCatalog(repoRoot) {
  const rootEntries = await fs.readdir(repoRoot, { withFileTypes: true });
  const categories = [];

  for (const dirent of rootEntries) {
    if (isIgnoredRootDir(dirent)) continue;

    const categoryName = dirent.name;
    const categoryPath = path.join(repoRoot, categoryName);
    const children = await fs.readdir(categoryPath, { withFileTypes: true });
    const items = children
      .filter((child) => !isIgnoredChildEntry(categoryName, child))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((child) => createSyncPackage(categoryName, child));

    if (items.length === 0) continue;
    categories.push({
      name: categoryName,
      title: getCategoryTitle(categoryName),
      items,
    });
  }

  return categories.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function flattenSyncCatalog(catalog) {
  return catalog.flatMap((category) => category.items);
}

export function resolvePackageSelection(catalog, arg) {
  const normalizedArg = normalizePackageArg(arg);
  if (!normalizedArg || normalizedArg === 'all') return flattenSyncCatalog(catalog);

  const category = catalog.find((item) => item.name === normalizedArg);
  if (category) return category.items;

  const matches = flattenSyncCatalog(catalog).filter((item) => item.aliases.includes(normalizedArg));
  if (matches.length === 1) return matches;
  if (matches.length > 1) {
    throw new Error(`同步内容名称不唯一: ${arg}，请使用完整路径，例如 ${matches[0].key}`);
  }

  throw new Error(`未知同步内容: ${arg}`);
}
