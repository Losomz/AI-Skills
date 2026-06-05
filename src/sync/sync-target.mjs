import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../utils/fs.mjs';
import { normalizePathForCompare } from '../utils/path.mjs';

export async function syncTarget({ repoRoot, projectDir, target }) {
  const sourcePath = path.join(repoRoot, target.from);
  const targetPath = path.join(projectDir, target.to);

  if (!await pathExists(sourcePath)) {
    throw new Error(`同步源不存在: ${sourcePath}`);
  }

  if (normalizePathForCompare(sourcePath) === normalizePathForCompare(targetPath)) {
    return { from: target.from, to: target.to, sourcePath, targetPath, skipped: true };
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true });

  return { from: target.from, to: target.to, sourcePath, targetPath, skipped: false };
}
