import path from 'node:path';
import process from 'node:process';

export function normalizePathForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function toGitPath(value) {
  return value.split(path.sep).join('/');
}

export function relativePathInsideProject(projectDir, targetPath) {
  const relative = path.relative(projectDir, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return toGitPath(relative);
}
