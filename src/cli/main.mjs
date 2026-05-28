#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { buildSyncCatalog, flattenSyncCatalog, resolvePackageSelection } from '../sync/catalog.mjs';
import { syncTarget } from '../sync/sync-target.mjs';
import { autoCommitAndPush } from '../git/auto-commit.mjs';
import { confirm, isInteractiveTerminal, selectMenu } from './menu.mjs';
import { printUsage } from './usage.mjs';
import { selectSyncPlan } from './sync-wizard.mjs';
import { POST_SYNC_ACTIONS, printSyncResult, selectPostSyncAction, waitForEnter } from './result-menu.mjs';
import { run } from '../utils/run.mjs';

const DEFAULT_REPO_URL = process.env.AGENTFRAMEWORK_REPO_URL || 'https://github.com/Losomz/AgentFramework.git';
const DEFAULT_REF = process.env.AGENTFRAMEWORK_REF || 'main';
const CACHE_ROOT = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');
const CACHE_REPO_DIR = path.join(CACHE_ROOT, 'repo');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_VERSION = '3.6.0';

// ── 工具 ──

const pathExists = (p) => fs.access(p).then(() => true, () => false);

const askQuestion = async (msg) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(msg); } finally { rl.close(); }
};

const isTTY = () => process.stdin.isTTY && process.stdout.isTTY;

function printBootstrapError(stage, error) {
  const msg = error?.message || String(error || '');
  console.log('');
  console.log('====================================');
  console.log('       AgentFramework Sync Result');
  console.log('====================================');
  console.log('状态: 失败');
  console.log(`阶段: ${stage}`);
  console.log(`远程源: ${DEFAULT_REPO_URL}`);
  console.log(`缓存目录: ${CACHE_REPO_DIR}`);
  console.log('');
  console.log('错误信息:');
  console.log(`  ${msg}`);
  console.log('');
}

async function promptRetryOrExit(stage, error) {
  printBootstrapError(stage, error);
  if (!isTTY()) return 'exit';
  while (true) {
    console.log('请选择：');
    console.log('  1. 重试');
    console.log('  2. 退出');
    const a = (await askQuestion('请输入序号: ')).trim();
    if (a === '1') return 'retry';
    if (a === '2' || a === '') return 'exit';
  }
}

// ── 缓存仓库 ──

async function ensureCache(rawArgs) {
  if (rawArgs.includes('--local')) {
    const srcDir = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
    if (await pathExists(path.join(srcDir, 'src', 'cli', 'main.mjs'))) return srcDir;
    throw new Error('--local 只能在 AgentFramework 仓库内使用');
  }

  await fs.mkdir(CACHE_ROOT, { recursive: true });

  if (!await pathExists(path.join(CACHE_REPO_DIR, '.git'))) {
    console.log(`首次设置，正在克隆 AgentFramework 到 ${CACHE_REPO_DIR}`);
    await run('git', ['clone', '--depth', '1', '--branch', DEFAULT_REF, DEFAULT_REPO_URL, CACHE_REPO_DIR], { stdio: 'inherit' });
    return CACHE_REPO_DIR;
  }

  console.log('正在更新 AgentFramework 缓存...');
  await run('git', ['-C', CACHE_REPO_DIR, 'remote', 'set-url', 'origin', DEFAULT_REPO_URL], { stdio: 'inherit' });
  await run('git', ['-C', CACHE_REPO_DIR, 'fetch', '--depth', '1', 'origin', DEFAULT_REF], { stdio: 'inherit' });
  await run('git', ['-C', CACHE_REPO_DIR, 'checkout', DEFAULT_REF], { stdio: 'inherit' });
  await run('git', ['-C', CACHE_REPO_DIR, 'reset', '--hard', `origin/${DEFAULT_REF}`], { stdio: 'inherit' });
  return CACHE_REPO_DIR;
}

// ── 同步逻辑（不变） ──

function parseArgs(rawArgs) {
  const flags = new Set(rawArgs.filter((arg) => arg.startsWith('--')));
  return {
    flags,
    selectedPackageArg: rawArgs.find((arg) => !arg.startsWith('--')),
    assumeYes: flags.has('--yes') || flags.has('-y'),
    skipAutoCommit: flags.has('--no-commit') || flags.has('--no-push'),
    noResultMenu: flags.has('--no-result-menu'),
  };
}

async function selectPackage(catalog, selectedPackageArg) {
  if (catalog.length === 0) throw new Error('未发现可同步内容。');
  if (selectedPackageArg) return resolvePackageSelection(catalog, selectedPackageArg);

  const categoryChoice = await selectMenu('请选择一级文件夹：', [
    ...catalog.map((c) => ({ key: c.name, label: `${c.name}/ - ${c.title}（${c.items.length} 项）`, value: c })),
    { key: 'all', label: 'all - 全部一级文件夹', value: 'all' },
  ], '请输入序号或文件夹名: ');
  if (!categoryChoice) return undefined;
  if (categoryChoice === 'all') return flattenSyncCatalog(catalog);

  return await selectMenu(`请选择 ${categoryChoice.name}/ 下要同步的内容：`, [
    ...categoryChoice.items.map((p) => ({ key: p.entryName, keys: [p.key, p.name], label: `${p.entryName} - ${p.description}`, value: [p] })),
    { key: 'all', keys: [`${categoryChoice.name}/all`], label: `all - ${categoryChoice.name}/ 下全部内容`, value: categoryChoice.items },
  ], '请输入序号或内容名: ');
}

function createBaseResult({ projectDir, sourceMode, repoRoot }) {
  return { success: false, cancelled: false, stage: '准备同步', projectDir, sourceMode, repoRoot, packages: [], syncedTargets: [], gitResult: undefined, error: undefined, hints: [] };
}

function getErrorHints(error) {
  const message = error?.message || String(error || '');
  const hints = [];
  if (/Could not read from remote repository|Connection closed|port 22|Permission denied|Repository not found/i.test(message)) {
    hints.push('当前默认远程源已改为 HTTPS；如果仍失败，请检查网络、代理或 GitHub 凭据。');
    hints.push('也可以临时指定 AGENTFRAMEWORK_REPO_URL=https://github.com/Losomz/AgentFramework.git 后重试。');
  }
  if (/git push|failed to push|rejected|non-fast-forward/i.test(message)) hints.push('同步文件已复制，但自动推送失败；请检查目标项目 Git 远程仓库状态后手动 push。');
  if (hints.length === 0) hints.push('请根据错误信息检查文件权限、网络或目标项目 Git 状态。');
  return hints;
}

async function showGitStatus(projectDir) {
  console.log('\nGit 状态:');
  try { await run('git', ['status', '--short', '--branch'], { cwd: projectDir, stdio: 'inherit' }); }
  catch (e) { console.log(`无法获取 Git 状态: ${e.message}`); }
  console.log('');
  await waitForEnter();
}

async function showDetails(result) {
  printSyncResult(result);
  if (result.error?.stack) { console.log('\n错误堆栈:'); console.log(result.error.stack); }
  console.log('');
  await waitForEnter();
}

async function executeSyncOnce({ catalog, projectDir, repoRoot, sourceMode, entryScriptPath, selectedPackageArg, forcedPackages, assumeYes, skipAutoCommit }) {
  const result = createBaseResult({ projectDir, sourceMode, repoRoot });
  try {
    let packages = forcedPackages, confirmedByWizard = false;
    if (!packages) {
      result.stage = '选择同步内容';
      const useWizard = !selectedPackageArg && isInteractiveTerminal();
      if (useWizard) {
        const sel = await selectSyncPlan({ catalog, context: { projectDir, sourceMode, repoRoot }, assumeYes });
        if (!sel) { result.cancelled = true; result.stage = '用户取消'; return result; }
        packages = sel.packages; confirmedByWizard = sel.confirmed;
      } else {
        console.log('====================================');
        console.log('       AgentFramework Sync');
        console.log('====================================');
        console.log(`目标项目: ${projectDir}`);
        console.log(`来源模式: ${sourceMode}`);
        console.log(`同步源: ${repoRoot}`);
        console.log('');
        packages = await selectPackage(catalog, selectedPackageArg);
        if (!packages) { result.cancelled = true; result.stage = '用户取消'; return result; }
      }
    }
    result.packages = packages;
    console.log('将全量覆盖同步以下文件或目录：');
    for (const pkg of packages) { console.log(`- ${pkg.title}`); for (const t of pkg.targets) console.log(`  ${t.from} -> ${t.to}`); }
    console.log('');
    result.stage = '确认同步';
    if (!confirmedByWizard && !await confirm('确认继续同步并删除/覆盖目标文件或目录吗？', assumeYes)) { result.cancelled = true; result.stage = '用户取消'; return result; }
    result.stage = '同步文件';
    const st = [];
    for (const pkg of packages) {
      console.log(`\n同步 ${pkg.title}...`);
      for (const t of pkg.targets) {
        const s = await syncTarget({ repoRoot, projectDir, target: t }); st.push(s);
        console.log(s.skipped ? `  - 已跳过: ${t.from} -> ${t.to}` : `  ✓ 已同步: ${t.from} -> ${t.to}`);
        if (t.after) console.log(`  提示: ${t.after}`);
      }
    }
    result.syncedTargets = st;
    result.stage = '自动提交和推送';
    result.gitResult = await autoCommitAndPush({ packages, syncedTargets: st, projectDir, entryScriptPath, skipAutoCommit });
    result.success = true; result.stage = '完成';
    return result;
  } catch (error) { result.error = error; result.hints = getErrorHints(error); return result; }
}

async function handlePostSyncAction(result, noResultMenu) {
  while (true) {
    const action = await selectPostSyncAction(result, { noResultMenu });
    if (action === POST_SYNC_ACTIONS.GIT_STATUS) { await showGitStatus(result.projectDir); continue; }
    if (action === POST_SYNC_ACTIONS.DETAILS) { await showDetails(result); continue; }
    return action;
  }
}

export async function main(options = {}) {
  const rawArgs = options.rawArgs || process.argv.slice(2);
  const projectDir = options.projectDir || process.cwd();
  const repoRoot = options.repoRoot;
  const entryScriptPath = options.entryScriptPath || process.env.AGENTFRAMEWORK_ENTRY_SCRIPT || undefined;
  const sourceMode = options.sourceMode || process.env.AGENTFRAMEWORK_SOURCE_MODE || 'local';
  const { flags, selectedPackageArg, assumeYes, skipAutoCommit, noResultMenu } = parseArgs(rawArgs);
  if (!repoRoot) throw new Error('缺少 AgentFramework 仓库根目录。');
  if (flags.has('--help') || flags.has('-h')) { printUsage({ defaultRepoUrl: DEFAULT_REPO_URL, defaultRef: DEFAULT_REF, cacheRoot: CACHE_ROOT }); return; }
  const catalog = await buildSyncCatalog(repoRoot);
  if (catalog.length === 0) throw new Error('未发现可同步内容。');

  let nextArg = selectedPackageArg, forced, lastResult;
  while (true) {
    lastResult = await executeSyncOnce({ catalog, projectDir, repoRoot, sourceMode, entryScriptPath, selectedPackageArg: nextArg, forcedPackages: forced, assumeYes, skipAutoCommit });
    const action = await handlePostSyncAction(lastResult, noResultMenu);
    if (action === POST_SYNC_ACTIONS.CONTINUE) { nextArg = undefined; forced = undefined; continue; }
    if (action === POST_SYNC_ACTIONS.RETRY) { forced = lastResult.packages?.length ? lastResult.packages : undefined; continue; }
    break;
  }
  if (lastResult && !lastResult.success && !lastResult.cancelled) process.exitCode = 1;
}

// ── 自动执行 ──

const thisFile = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const invokedFile = (process.argv[1] || '').replace(/\\/g, '/');
if (thisFile === invokedFile) {
  (async () => {
    const rawArgs = process.argv.slice(2);

    let repoRoot;
    while (true) {
      try { repoRoot = await ensureCache(rawArgs); break; }
      catch (e) { if (await promptRetryOrExit('更新缓存', e) === 'exit') { process.exitCode = 1; break; } }
    }
    if (!repoRoot) process.exit(process.exitCode || 1);

    // 自我升级：缓存更新后本文件若已变化则重新执行。
    const useLocal = rawArgs.includes('--local');
    if (!useLocal && !rawArgs.includes('--skip-self-update')) {
      try {
        const cached = path.join(repoRoot, 'src', 'cli', 'main.mjs');
        if (path.resolve(cached).toLowerCase() !== path.resolve(SCRIPT_PATH).toLowerCase()) {
          const [a, b] = await Promise.all([fs.readFile(cached), fs.readFile(SCRIPT_PATH)]);
          if (Buffer.compare(a, b) !== 0) {
            console.log('检测到同步脚本有更新，正在重新执行...');
            await new Promise((resolve, reject) => {
              const child = spawn(process.execPath, [cached, ...rawArgs, '--skip-self-update'], { cwd: process.cwd(), stdio: 'inherit', shell: false });
              child.on('error', reject);
              child.on('exit', (c) => process.exit(c ?? 1));
            });
          }
        }
      } catch {}
    }

    while (true) {
      try {
        await main({ rawArgs, projectDir: process.cwd(), repoRoot, sourceMode: useLocal ? 'local' : 'git cache', entryScriptPath: SCRIPT_PATH });
        break;
      } catch (e) {
        if (await promptRetryOrExit('执行同步', e) === 'exit') { process.exitCode = 1; break; }
      }
    }

    if (isTTY() && !rawArgs.includes('--no-pause') && !process.env.CI) {
      console.log('\n同步流程已结束。按 Enter 退出...');
      await askQuestion('');
    }
  })();
}
