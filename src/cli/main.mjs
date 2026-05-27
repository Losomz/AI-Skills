import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildSyncCatalog, flattenSyncCatalog, resolvePackageSelection } from '../sync/catalog.mjs';
import { syncTarget } from '../sync/sync-target.mjs';
import { autoCommitAndPush } from '../git/auto-commit.mjs';
import { confirm, selectMenu } from './menu.mjs';
import { printUsage } from './usage.mjs';

const DEFAULT_REPO_URL = process.env.AGENTFRAMEWORK_REPO_URL || 'git@github.com:Losomz/AgentFramework.git';
const DEFAULT_REF = process.env.AGENTFRAMEWORK_REF || 'main';
const CACHE_ROOT = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');

function parseArgs(rawArgs) {
  const flags = new Set(rawArgs.filter((arg) => arg.startsWith('--')));
  return {
    flags,
    selectedPackageArg: rawArgs.find((arg) => !arg.startsWith('--')),
    assumeYes: flags.has('--yes') || flags.has('-y'),
    skipAutoCommit: flags.has('--no-commit') || flags.has('--no-push'),
  };
}

async function selectPackage(repoRoot, selectedPackageArg) {
  const catalog = await buildSyncCatalog(repoRoot);
  if (catalog.length === 0) {
    throw new Error('未发现可同步内容。');
  }

  if (selectedPackageArg) {
    return resolvePackageSelection(catalog, selectedPackageArg);
  }

  const categoryChoice = await selectMenu(
    '请选择一级文件夹：',
    [
      ...catalog.map((category) => ({
        key: category.name,
        label: `${category.name}/ - ${category.title}（${category.items.length} 项）`,
        value: category,
      })),
      { key: 'all', label: 'all - 全部一级文件夹', value: 'all' },
    ],
    '请输入序号或文件夹名: ',
  );

  if (!categoryChoice) return undefined;
  if (categoryChoice === 'all') return flattenSyncCatalog(catalog);

  const contentChoice = await selectMenu(
    `请选择 ${categoryChoice.name}/ 下要同步的内容：`,
    [
      ...categoryChoice.items.map((pkg) => ({
        key: pkg.entryName,
        keys: [pkg.key, pkg.name],
        label: `${pkg.entryName} - ${pkg.description}`,
        value: [pkg],
      })),
      { key: 'all', keys: [`${categoryChoice.name}/all`], label: `all - ${categoryChoice.name}/ 下全部内容`, value: categoryChoice.items },
    ],
    '请输入序号或内容名: ',
  );

  return contentChoice;
}

export async function main(options = {}) {
  const rawArgs = options.rawArgs || process.argv.slice(2);
  const projectDir = options.projectDir || process.cwd();
  const repoRoot = options.repoRoot;
  const entryScriptPath = options.entryScriptPath || process.env.AGENTFRAMEWORK_ENTRY_SCRIPT || undefined;
  const sourceMode = options.sourceMode || process.env.AGENTFRAMEWORK_SOURCE_MODE || 'local';
  const { flags, selectedPackageArg, assumeYes, skipAutoCommit } = parseArgs(rawArgs);

  if (!repoRoot) {
    throw new Error('缺少 AgentFramework 仓库根目录。');
  }

  if (flags.has('--help') || flags.has('-h')) {
    printUsage({ defaultRepoUrl: DEFAULT_REPO_URL, defaultRef: DEFAULT_REF, cacheRoot: CACHE_ROOT });
    return;
  }

  console.log('====================================');
  console.log('       AgentFramework Sync');
  console.log('====================================');
  console.log(`目标项目: ${projectDir}`);
  console.log(`来源模式: ${sourceMode}`);
  console.log(`同步源: ${repoRoot}`);
  console.log('');

  const packages = await selectPackage(repoRoot, selectedPackageArg);
  if (!packages) {
    console.log('已取消同步。');
    return;
  }

  console.log('将全量覆盖同步以下文件或目录：');
  for (const pkg of packages) {
    console.log(`- ${pkg.title}`);
    for (const target of pkg.targets) {
      console.log(`  ${target.from} -> ${target.to}`);
    }
  }
  console.log('');

  if (!await confirm('确认继续同步并删除/覆盖目标文件或目录吗？', assumeYes)) {
    console.log('已取消同步。');
    return;
  }

  const syncedTargets = [];
  for (const pkg of packages) {
    console.log(`\n同步 ${pkg.title}...`);
    for (const target of pkg.targets) {
      const synced = await syncTarget({ repoRoot, projectDir, target });
      syncedTargets.push(synced);
      if (synced.skipped) {
        console.log(`  - 已跳过（源和目标相同）: ${target.from} -> ${target.to}`);
      } else {
        console.log(`  ✓ 已同步: ${target.from} -> ${target.to}`);
      }
      if (target.after) console.log(`  提示: ${target.after}`);
    }
  }

  await autoCommitAndPush({
    packages,
    syncedTargets,
    projectDir,
    entryScriptPath,
    skipAutoCommit,
  });

  console.log('\n同步完成。');
}
