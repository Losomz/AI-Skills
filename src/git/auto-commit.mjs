import { run } from '../utils/run.mjs';
import { relativePathInsideProject } from '../utils/path.mjs';

function getCommitScope(packages) {
  if (packages.length === 1) return packages[0].commitScope || packages[0].name;

  const categories = new Set(packages.map((pkg) => pkg.category));
  if (categories.size === 1) return [...categories][0];

  return 'tools';
}

async function isGitIgnored(projectDir, gitPath) {
  try {
    await run('git', ['check-ignore', '-q', '--', gitPath], { cwd: projectDir });
    return true;
  } catch {
    return false;
  }
}

async function filterCommitPaths(projectDir, paths) {
  const result = [];
  for (const item of paths) {
    if (await isGitIgnored(projectDir, item)) {
      console.log(`  - 跳过 Git 忽略路径: ${item}`);
      continue;
    }
    result.push(item);
  }
  return result;
}

export async function autoCommitAndPush({ packages, syncedTargets, projectDir, entryScriptPath, skipAutoCommit }) {
  if (skipAutoCommit) {
    console.log('\n已跳过自动提交和推送。');
    return;
  }

  const repoCheck = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectDir }).catch(() => null);
  if (!repoCheck || repoCheck.stdout.trim() !== 'true') {
    console.log('\n当前目录不是 Git 仓库，已跳过自动提交和推送。');
    return;
  }

  const commitPaths = [];
  for (const target of syncedTargets) {
    const relative = relativePathInsideProject(projectDir, target.targetPath);
    if (relative) commitPaths.push(relative);
  }

  if (entryScriptPath) {
    const scriptRelative = relativePathInsideProject(projectDir, entryScriptPath);
    if (scriptRelative) commitPaths.push(scriptRelative);
  }

  const uniquePaths = await filterCommitPaths(projectDir, [...new Set(commitPaths)]);
  if (uniquePaths.length === 0) {
    console.log('\n没有可提交的同步路径，已跳过自动提交和推送。');
    return;
  }

  await run('git', ['add', '-A', '--', ...uniquePaths], { cwd: projectDir });
  const status = await run('git', ['status', '--porcelain', '--', ...uniquePaths], { cwd: projectDir });
  if (!status.stdout.trim()) {
    console.log('\n同步路径没有 Git 改动，已跳过自动提交和推送。');
    return;
  }

  const scope = getCommitScope(packages);
  const message = `✨ feat(${scope}): 工具升级`;
  console.log(`\n自动提交同步改动：${message}`);
  await run('git', ['commit', '-m', message, '--', ...uniquePaths], { cwd: projectDir, stdio: 'inherit' });
  console.log('正在推送同步提交...');
  await run('git', ['push'], { cwd: projectDir, stdio: 'inherit' });
}
