#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_URL = process.env.AGENTFRAMEWORK_REPO_URL || 'git@github.com:Losomz/AgentFramework.git';
const DEFAULT_REF = process.env.AGENTFRAMEWORK_REF || 'main';
const CACHE_ROOT = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');
const CACHE_REPO_DIR = path.join(CACHE_ROOT, 'repo');
const PROJECT_DIR = process.cwd();
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const SELF_UPDATE_FLAG = '--skip-self-update';
// Bump this using x.y.z semantic versioning when changing the sync bootstrap.
const SYNC_SCRIPT_VERSION = '3.3.0';
// Legacy marker for agent-sync.mjs <= 3 numeric self-updaters. Keep it above old numeric versions.
// SYNC_SCRIPT_VERSION = 4

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((arg) => arg.startsWith('--')));
const useLocalSource = flags.has('--local');
const skipSelfUpdate = flags.has(SELF_UPDATE_FLAG);

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

function runNodeScript(scriptPath, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...env },
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

async function runCli(repoRoot) {
  const cliPath = path.join(repoRoot, 'bin', 'agent-sync.mjs');
  if (!await pathExists(cliPath)) {
    throw new Error(`AgentFramework CLI 不存在: ${cliPath}`);
  }

  const code = await runNodeScript(cliPath, rawArgs, {
    AGENTFRAMEWORK_ENTRY_SCRIPT: SCRIPT_PATH,
    AGENTFRAMEWORK_SOURCE_MODE: useLocalSource ? 'local' : 'git cache',
  });
  process.exit(code);
}

async function main() {
  const repoRoot = await ensureRepo();
  await maybeSelfUpdate(repoRoot);
  await runCli(repoRoot);
}

main().catch((error) => {
  console.error('同步失败:', error.message);
  process.exitCode = 1;
});
