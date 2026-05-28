#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const DEFAULT_REPO_URL = process.env.AGENTFRAMEWORK_REPO_URL || 'https://github.com/Losomz/AgentFramework.git';
const DEFAULT_REF = process.env.AGENTFRAMEWORK_REF || 'main';
const CACHE_ROOT = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');
const CACHE_REPO_DIR = path.join(CACHE_ROOT, 'repo');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
// Bump this when changing the sync bootstrap. Old copies in target projects
// detect a higher version here and self-update automatically.
const SYNC_SCRIPT_VERSION = '4.0.0';

const rawArgs = process.argv.slice(2);
const useLocalSource = rawArgs.includes('--local');

const pathExists = (p) => fs.access(p).then(() => true, () => false);

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: 'inherit', shell: false });
  child.on('error', reject);
  child.on('exit', (c) => c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${c}`)));
});

const askQuestion = async (msg) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(msg); } finally { rl.close(); }
};

const isTTY = () => process.stdin.isTTY && process.stdout.isTTY;

function printError(stage, error) {
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
  printError(stage, error);
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

async function ensureRepo() {
  if (useLocalSource) return SCRIPT_DIR;

  await fs.mkdir(CACHE_ROOT, { recursive: true });

  if (!await pathExists(path.join(CACHE_REPO_DIR, '.git'))) {
    console.log(`首次同步，正在拉取 AgentFramework: ${DEFAULT_REPO_URL}`);
    await run('git', ['clone', '--depth', '1', '--branch', DEFAULT_REF, DEFAULT_REPO_URL, CACHE_REPO_DIR]);
    return CACHE_REPO_DIR;
  }

  console.log('正在更新 AgentFramework 缓存...');
  await run('git', ['-C', CACHE_REPO_DIR, 'remote', 'set-url', 'origin', DEFAULT_REPO_URL]);
  await run('git', ['-C', CACHE_REPO_DIR, 'fetch', '--depth', '1', 'origin', DEFAULT_REF]);
  await run('git', ['-C', CACHE_REPO_DIR, 'checkout', DEFAULT_REF]);
  await run('git', ['-C', CACHE_REPO_DIR, 'reset', '--hard', `origin/${DEFAULT_REF}`]);
  return CACHE_REPO_DIR;
}

async function maybeSelfUpdate(repoRoot) {
  if (useLocalSource || rawArgs.includes('--skip-self-update')) return;

  const sourcePath = path.join(repoRoot, 'agent-sync.mjs');
  if (!await pathExists(sourcePath)) return;
  if (path.resolve(sourcePath).toLowerCase() === path.resolve(SCRIPT_PATH).toLowerCase()) return;

  try {
    const [a, b] = await Promise.all([fs.readFile(sourcePath), fs.readFile(SCRIPT_PATH)]);
    if (Buffer.compare(a, b) !== 0) {
      console.log('检测到同步脚本有更新，正在自我升级并重新执行...');
      await fs.copyFile(sourcePath, SCRIPT_PATH);
      const args = [...rawArgs, '--skip-self-update'];
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { cwd: process.cwd(), stdio: 'inherit', shell: false });
        child.on('error', reject);
        child.on('exit', (c) => process.exit(c ?? 1));
      });
    }
  } catch {}
}

// ── 入口 ──

try {
  let repoRoot;
  while (true) {
    try { repoRoot = await ensureRepo(); break; }
    catch (e) { if (await promptRetryOrExit('更新缓存', e) === 'exit') { process.exitCode = 1; break; } }
  }
  if (!repoRoot) process.exit(process.exitCode || 1);

  await maybeSelfUpdate(repoRoot);

  const cliPath = pathToFileURL(path.join(repoRoot, 'src', 'cli', 'main.mjs')).href;
  while (true) {
    try {
      const { main } = await import(cliPath);
      await main({
        rawArgs,
        projectDir: process.cwd(),
        repoRoot,
        sourceMode: useLocalSource ? 'local' : 'git cache',
        entryScriptPath: SCRIPT_PATH,
      });
      break;
    } catch (e) {
      if (await promptRetryOrExit('执行同步', e) === 'exit') { process.exitCode = 1; break; }
    }
  }
} catch (e) {
  printError('启动同步脚本', e);
  process.exitCode = 1;
}

if (isTTY() && !rawArgs.includes('--no-pause') && !process.env.CI) {
  console.log('\n同步流程已结束。按 Enter 退出...');
  await askQuestion('');
}
