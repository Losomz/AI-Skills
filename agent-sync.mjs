#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_URL = process.env.AGENTFRAMEWORK_REPO_URL || 'git@github.com:Losomz/AgentFramework.git';
const DEFAULT_REF = process.env.AGENTFRAMEWORK_REF || 'main';
const CACHE_ROOT = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');
const CACHE_REPO_DIR = path.join(CACHE_ROOT, 'repo');
const PROJECT_DIR = process.cwd();
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const SELF_UPDATE_FLAG = '--skip-self-update';
// Bump this using x.y.z semantic versioning when changing the sync script.
const SYNC_SCRIPT_VERSION = '3.1.0';
// Legacy marker for agent-sync.mjs <= 3 numeric self-updaters. Keep it above old numeric versions.
// SYNC_SCRIPT_VERSION = 4

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((arg) => arg.startsWith('--')));
const selectedPackageArg = rawArgs.find((arg) => !arg.startsWith('--'));
const assumeYes = flags.has('--yes') || flags.has('-y');
const useLocalSource = flags.has('--local');
const skipSelfUpdate = flags.has(SELF_UPDATE_FLAG);
const skipAutoCommit = flags.has('--no-commit') || flags.has('--no-push');

const syncPackages = [
  {
    name: 'pi',
    title: 'Pi 配置',
    description: '全量覆盖同步 Pi 配置（.pi）',
    targets: [
      {
        from: 'configs/.pi',
        to: '.pi',
        after: '请在 Pi 中执行 /reload 重新加载扩展。',
      },
    ],
  },
  {
    name: 'opencode',
    title: 'OpenCode 配置',
    description: '全量覆盖同步 OpenCode 配置（.opencode）',
    targets: [
      { from: 'configs/.opencode', to: '.opencode' },
    ],
  },
];

function printUsage() {
  console.log(`AgentFramework Sync\n\nUsage:\n  node agent-sync.mjs                # 进入菜单，方向键/Enter 选择同步内容\n  node agent-sync.mjs pi             # 全量覆盖同步 Pi 配置\n  node agent-sync.mjs opencode       # 全量覆盖同步 OpenCode 配置\n  node agent-sync.mjs all --yes      # 同步全部且不询问确认\n  node agent-sync.mjs pi --local     # 开发期：从当前仓库 configs/ 同步，不拉远程、不自我升级\n  node agent-sync.mjs pi --no-commit # 只同步，不自动提交和推送\n\nBehavior:\n  - 默认先更新 git cache，并在发现 agent-sync.mjs 有更新时自我升级后重新执行。\n  - 同步时会删除目标目录再复制配置源，不创建备份。\n  - 选择内容和确认步骤优先用菜单按钮式交互；没有 TTY 时才退回文本输入。\n  - 同步完成后会自动提交并推送同步产生的 Git 改动，提交信息形如：✨ feat(pi): 工具升级。\n\nEnvironment:\n  AGENTFRAMEWORK_REPO_URL=${DEFAULT_REPO_URL}\n  AGENTFRAMEWORK_REF=${DEFAULT_REF}\n  AGENTFRAMEWORK_HOME=${CACHE_ROOT}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.stdio || 'pipe',
      shell: false,
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.stdio === 'inherit') process.stdout.write(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.stdio === 'inherit') process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      reject(new Error(stderr.trim() || `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureTool(command, hint) {
  try {
    await run(command, ['--version']);
  } catch {
    throw new Error(hint);
  }
}

async function ensureRepo() {
  if (useLocalSource) {
    return SCRIPT_DIR;
  }

  await ensureTool('git', '未检测到 git，请先安装 git。');
  await fs.mkdir(CACHE_ROOT, { recursive: true });

  if (!await pathExists(path.join(CACHE_REPO_DIR, '.git'))) {
    console.log(`首次同步，正在拉取 AgentFramework: ${DEFAULT_REPO_URL}`);
    await run('git', ['clone', '--depth', '1', '--branch', DEFAULT_REF, DEFAULT_REPO_URL, CACHE_REPO_DIR], {
      stdio: 'inherit',
    });
    return CACHE_REPO_DIR;
  }

  console.log('正在更新 AgentFramework 缓存...');
  await run('git', ['remote', 'set-url', 'origin', DEFAULT_REPO_URL], { cwd: CACHE_REPO_DIR });
  await run('git', ['fetch', '--depth', '1', 'origin', DEFAULT_REF], { cwd: CACHE_REPO_DIR, stdio: 'inherit' });
  await run('git', ['checkout', DEFAULT_REF], { cwd: CACHE_REPO_DIR, stdio: 'inherit' });
  await run('git', ['reset', '--hard', `origin/${DEFAULT_REF}`], { cwd: CACHE_REPO_DIR, stdio: 'inherit' });
  return CACHE_REPO_DIR;
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function filesEqual(a, b) {
  try {
    const [left, right] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return Buffer.compare(left, right) === 0;
  } catch {
    return false;
  }
}

function parseSyncScriptVersion(value) {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return [0, 0, Number(text)];
  if (!/^\d+\.\d+\.\d+$/.test(text)) return [0, 0, 0];
  return text.split('.').map((part) => Number(part));
}

function compareSyncScriptVersions(left, right) {
  const leftParts = parseSyncScriptVersion(left);
  const rightParts = parseSyncScriptVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

async function getSyncScriptVersion(scriptPath) {
  try {
    const content = await fs.readFile(scriptPath, 'utf-8');
    const semverMatch = content.match(/SYNC_SCRIPT_VERSION\s*=\s*['"`](\d+\.\d+\.\d+)['"`]/);
    if (semverMatch) return semverMatch[1];

    const legacyMatch = content.match(/SYNC_SCRIPT_VERSION\s*=\s*(\d+)/);
    return legacyMatch ? legacyMatch[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function maybeSelfUpdate(repoRoot) {
  if (useLocalSource || skipSelfUpdate) return false;

  const sourceScript = path.join(repoRoot, 'agent-sync.mjs');
  if (!await pathExists(sourceScript)) return false;
  if (normalizePathForCompare(sourceScript) === normalizePathForCompare(SCRIPT_PATH)) return false;
  if (await filesEqual(sourceScript, SCRIPT_PATH)) return false;

  const sourceVersion = await getSyncScriptVersion(sourceScript);
  if (compareSyncScriptVersions(sourceVersion, SYNC_SCRIPT_VERSION) <= 0) return false;

  console.log(`检测到同步脚本有更新（v${SYNC_SCRIPT_VERSION} -> v${sourceVersion}），正在自我升级...`);
  await fs.copyFile(sourceScript, SCRIPT_PATH);
  try {
    const sourceStat = await fs.stat(sourceScript);
    await fs.chmod(SCRIPT_PATH, sourceStat.mode);
  } catch {
    // Ignore chmod failures on platforms/filesystems that do not support it.
  }

  const nextArgs = rawArgs.includes(SELF_UPDATE_FLAG) ? rawArgs : [...rawArgs, SELF_UPDATE_FLAG];
  console.log('同步脚本已更新，正在重新执行...');
  const code = await runNodeScript(SCRIPT_PATH, nextArgs);
  process.exit(code);
}

async function syncTarget(repoRoot, target) {
  const sourcePath = path.join(repoRoot, target.from);
  const targetPath = path.join(PROJECT_DIR, target.to);

  if (!await pathExists(sourcePath)) {
    throw new Error(`同步源不存在: ${sourcePath}`);
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true });

  return { sourcePath, targetPath };
}

function toGitPath(value) {
  return value.split(path.sep).join('/');
}

function relativePathInsideProject(targetPath) {
  const relative = path.relative(PROJECT_DIR, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return toGitPath(relative);
}

function getCommitScope(packages) {
  if (packages.length === 1) return packages[0].name;
  return 'tools';
}

async function isGitIgnored(gitPath) {
  try {
    await run('git', ['check-ignore', '-q', '--', gitPath], { cwd: PROJECT_DIR });
    return true;
  } catch {
    return false;
  }
}

async function filterCommitPaths(paths) {
  const result = [];
  for (const item of paths) {
    if (await isGitIgnored(item)) {
      console.log(`  - 跳过 Git 忽略路径: ${item}`);
      continue;
    }
    result.push(item);
  }
  return result;
}

async function autoCommitAndPush(packages, syncedTargets) {
  if (skipAutoCommit) {
    console.log('\n已跳过自动提交和推送。');
    return;
  }

  const repoCheck = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: PROJECT_DIR }).catch(() => null);
  if (!repoCheck || repoCheck.stdout.trim() !== 'true') {
    console.log('\n当前目录不是 Git 仓库，已跳过自动提交和推送。');
    return;
  }

  const commitPaths = [];
  for (const target of syncedTargets) {
    const relative = relativePathInsideProject(target.targetPath);
    if (relative) commitPaths.push(relative);
  }

  const scriptRelative = relativePathInsideProject(SCRIPT_PATH);
  if (scriptRelative) commitPaths.push(scriptRelative);

  const uniquePaths = await filterCommitPaths([...new Set(commitPaths)]);
  if (uniquePaths.length === 0) {
    console.log('\n没有可提交的同步路径，已跳过自动提交和推送。');
    return;
  }

  await run('git', ['add', '-A', '--', ...uniquePaths], { cwd: PROJECT_DIR });
  const status = await run('git', ['status', '--porcelain', '--', ...uniquePaths], { cwd: PROJECT_DIR });
  if (!status.stdout.trim()) {
    console.log('\n同步路径没有 Git 改动，已跳过自动提交和推送。');
    return;
  }

  const scope = getCommitScope(packages);
  const message = `✨ feat(${scope}): 工具升级`;
  console.log(`\n自动提交同步改动：${message}`);
  await run('git', ['commit', '-m', message, '--', ...uniquePaths], { cwd: PROJECT_DIR, stdio: 'inherit' });
  console.log('正在推送同步提交...');
  await run('git', ['push'], { cwd: PROJECT_DIR, stdio: 'inherit' });
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function clearMenuScreen() {
  output.write('\x1b[2J\x1b[0f');
}

async function selectMenu(message, items, fallbackPrompt) {
  if (!isInteractiveTerminal()) {
    console.log(message);
    items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.label}`);
    });
    console.log('');

    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(fallbackPrompt);
      const value = answer.trim();
      if (!value) return undefined;

      const byNumber = Number(value);
      if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= items.length) {
        return items[byNumber - 1].value;
      }

      const byLabel = items.find((item) => item.label === value || item.value === value);
      return byLabel?.value;
    } finally {
      rl.close();
    }
  }

  return await new Promise((resolve) => {
    let selectedIndex = 0;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKeypress);
      if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      output.write('\x1b[?25h');
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const render = () => {
      clearMenuScreen();
      output.write('\x1b[?25l');
      console.log(message);
      console.log('');
      items.forEach((item, index) => {
        const marker = index === selectedIndex ? '❯' : ' ';
        console.log(` ${marker} ${item.label}`);
      });
      console.log('');
      console.log('↑↓ 选择，Enter 确认，Esc 取消');
    };

    const onKeypress = (_str, key) => {
      if (!key) return;
      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
        return;
      }
      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(items[selectedIndex]?.value);
        return;
      }
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        finish(undefined);
        return;
      }
      if (key.name && /^[1-9]$/.test(key.name)) {
        const index = Number(key.name) - 1;
        if (index >= 0 && index < items.length) {
          selectedIndex = index;
          render();
        }
      }
    };

    emitKeypressEvents(process.stdin);
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
    render();
  });
}

async function confirm(message) {
  if (assumeYes) return true;

  const choice = await selectMenu(message, [
    { label: '继续同步', value: true },
    { label: '取消同步', value: false },
  ], '请输入序号: ');

  return Boolean(choice);
}

async function selectPackage() {
  if (selectedPackageArg) {
    if (selectedPackageArg === 'all') return syncPackages;
    const pkg = syncPackages.find((item) => item.name === selectedPackageArg);
    if (!pkg) {
      throw new Error(`未知同步包: ${selectedPackageArg}`);
    }
    return [pkg];
  }

  const choice = await selectMenu(
    '请选择要同步的内容：',
    [
      ...syncPackages.map((pkg) => ({
        label: `${pkg.title} - ${pkg.description}`,
        value: [pkg],
      })),
      { label: 'all - 全部', value: syncPackages },
    ],
    '请输入序号: ',
  );

  return choice;
}

async function main() {
  if (flags.has('--help') || flags.has('-h')) {
    printUsage();
    return;
  }

  console.log('====================================');
  console.log('       AgentFramework Sync');
  console.log('====================================');
  console.log(`目标项目: ${PROJECT_DIR}`);
  console.log(`来源模式: ${useLocalSource ? 'local' : 'git cache'}`);
  if (!useLocalSource) {
    console.log(`仓库: ${DEFAULT_REPO_URL}#${DEFAULT_REF}`);
  }
  console.log('');

  const repoRoot = await ensureRepo();
  await maybeSelfUpdate(repoRoot);
  const packages = await selectPackage();
  if (!packages) {
    console.log('已取消同步。');
    return;
  }

  console.log('将全量覆盖同步：');
  for (const pkg of packages) {
    console.log(`- ${pkg.title}`);
    for (const target of pkg.targets) {
      console.log(`  ${target.from} -> ${target.to}`);
    }
  }
  console.log('');

  if (!await confirm('确认继续同步并删除/覆盖目标目录吗？')) {
    console.log('已取消同步。');
    return;
  }

  const syncedTargets = [];
  for (const pkg of packages) {
    console.log(`\n同步 ${pkg.title}...`);
    for (const target of pkg.targets) {
      const synced = await syncTarget(repoRoot, target);
      syncedTargets.push(synced);
      console.log(`  ✓ 已同步: ${target.from} -> ${target.to}`);
      if (target.after) console.log(`  提示: ${target.after}`);
    }
  }

  await autoCommitAndPush(packages, syncedTargets);

  console.log('\n同步完成。');
}

main().catch((error) => {
  console.error('同步失败:', error.message);
  process.exitCode = 1;
});
