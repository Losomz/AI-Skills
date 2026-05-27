import fs from 'node:fs/promises';

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function filesEqual(a, b) {
  try {
    const [left, right] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return Buffer.compare(left, right) === 0;
  } catch {
    return false;
  }
}
