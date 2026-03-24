#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const invocationDir = process.cwd();
const repoUrl = process.env.AGENTFRAMEWORK_REPO_URL || 'https://github.com/Losomz/AI-Agents.git';
const cacheRoot = process.env.AGENTFRAMEWORK_HOME || path.join(os.homedir(), '.agentframework');
const repoDir = path.join(cacheRoot, 'repo');
const runtimeDir = path.join(repoDir, 'runtime');
const runtimeEntry = path.join(runtimeDir, 'menu-runtime.mjs');
const runtimePackagePath = path.join(runtimeDir, 'package.json');
const runtimeLockPath = path.join(runtimeDir, 'package-lock.json');
const bootstrapStatePath = path.join(cacheRoot, 'bootstrap-state.json');

function quoteWindowsArg(value) {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
        return value;
    }

    return `"${value.replace(/"/g, '\\"')}"`;
}

function run(command, commandArgs, options = {}) {
    return new Promise((resolve, reject) => {
        const spawnCommand = process.platform === 'win32' && command === 'npm'
            ? 'cmd.exe'
            : command;
        const spawnArgs = process.platform === 'win32' && command === 'npm'
            ? ['/d', '/s', '/c', ['npm', ...commandArgs].map(quoteWindowsArg).join(' ')]
            : commandArgs;
        const child = spawn(spawnCommand, spawnArgs, {
            cwd: options.cwd,
            stdio: options.stdio || 'pipe',
            shell: false,
            env: {
                ...process.env,
                ...options.env,
            },
        });

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
                if (options.stdio === 'inherit') {
                    process.stdout.write(chunk);
                }
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
                if (options.stdio === 'inherit') {
                    process.stderr.write(chunk);
                }
            });
        }

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                return;
            }
            reject(new Error(stderr.trim() || `${command} ${commandArgs.join(' ')} exited with code ${code ?? 'unknown'}`));
        });
    });
}

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readState() {
    if (!await exists(bootstrapStatePath)) {
        return {};
    }

    try {
        return await readJson(bootstrapStatePath);
    } catch {
        return {};
    }
}

async function ensureTool(command, hint) {
    try {
        await run(command, ['--version']);
    } catch {
        throw new Error(hint);
    }
}

async function ensureRepoExists() {
    await fs.mkdir(cacheRoot, { recursive: true });

    if (await exists(path.join(repoDir, '.git'))) {
        return false;
    }

    console.log(`首次运行，正在拉取 AgentFramework runtime: ${repoUrl}`);
    await run('git', ['clone', '--depth', '1', repoUrl, repoDir], { stdio: 'inherit' });
    return true;
}

async function getRemoteTrackingRef() {
    const { stdout } = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoDir });
    return stdout;
}

async function getRuntimeVersionFromPackage(packageText) {
    try {
        return JSON.parse(packageText).version || 'unknown';
    } catch {
        return 'unknown';
    }
}

async function syncRuntimeRepo() {
    const cloned = await ensureRepoExists();
    if (cloned) {
        return { updated: true, previousCommit: null, currentCommit: await getHeadCommit(), changedFiles: ['initial-clone'] };
    }

    await run('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: repoDir });
    const previousCommit = await getHeadCommit();
    await run('git', ['fetch', 'origin'], { cwd: repoDir, stdio: 'inherit' });
    const remoteRef = await getRemoteTrackingRef();
    const { stdout: remoteCommit } = await run('git', ['rev-parse', remoteRef], { cwd: repoDir });

    if (previousCommit === remoteCommit) {
        return { updated: false, previousCommit, currentCommit: previousCommit, changedFiles: [] };
    }

    const previousVersion = await getLocalRuntimeVersion();
    const { stdout: remotePackage } = await run('git', ['show', `${remoteRef}:runtime/package.json`], { cwd: repoDir });
    const remoteVersion = await getRuntimeVersionFromPackage(remotePackage);
    console.log(`检测到 runtime 更新: ${previousVersion} -> ${remoteVersion}`);

    const { stdout: changedFilesText } = await run('git', ['diff', '--name-only', previousCommit, remoteCommit], { cwd: repoDir });
    await run('git', ['pull', '--ff-only', 'origin'], { cwd: repoDir, stdio: 'inherit' });

    return {
        updated: true,
        previousCommit,
        currentCommit: remoteCommit,
        changedFiles: changedFilesText ? changedFilesText.split(/\r?\n/).filter(Boolean) : [],
    };
}

async function getHeadCommit() {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    return stdout;
}

async function getLocalRuntimeVersion() {
    if (!await exists(runtimePackagePath)) {
        return 'unknown';
    }

    const runtimePackage = await readJson(runtimePackagePath);
    return runtimePackage.version || 'unknown';
}

async function getInstallFingerprint() {
    const hash = crypto.createHash('sha256');

    for (const filePath of [runtimePackagePath, runtimeLockPath]) {
        if (await exists(filePath)) {
            hash.update(await fs.readFile(filePath));
        }
    }

    return hash.digest('hex');
}

function shouldReinstallDependencies(state, syncResult) {
    if (!syncResult.updated) {
        return false;
    }

    if (syncResult.changedFiles.includes('initial-clone')) {
        return true;
    }

    return syncResult.changedFiles.some((file) => file === 'runtime/package.json' || file === 'runtime/package-lock.json');
}

async function ensureRuntimeDependencies(syncResult) {
    const state = await readState();
    const fingerprint = await getInstallFingerprint();
    const modulesDir = path.join(runtimeDir, 'node_modules');
    const needsInstall = !await exists(modulesDir)
        || state.installFingerprint !== fingerprint
        || shouldReinstallDependencies(state, syncResult);

    if (!needsInstall) {
        return;
    }

    console.log('正在安装 runtime 依赖...');
    await run('npm', ['install', '--omit=dev', '--no-fund', '--no-audit'], { cwd: runtimeDir, stdio: 'inherit' });

    await writeJson(bootstrapStatePath, {
        installFingerprint: fingerprint,
        lastCommit: syncResult.currentCommit,
    });
}

async function runRuntime() {
    await run(process.execPath, [runtimeEntry, ...args], {
        cwd: invocationDir,
        stdio: 'inherit',
        env: {
            AGENTFRAMEWORK_TARGET_DIR: invocationDir,
            AGENTFRAMEWORK_RUNTIME_ROOT: repoDir,
        },
    });
}

async function main() {
    await ensureTool('git', '未检测到 git，请先安装 git 后再执行 agent-menu。');
    await ensureTool('npm', '未检测到 npm，请先安装 Node.js/npm 后再执行 agent-menu。');

    const syncResult = await syncRuntimeRepo();
    if (!syncResult.updated) {
        console.log('runtime 已是最新版本。');
    }

    if (!await exists(runtimeEntry)) {
        throw new Error(`未找到 runtime 入口: ${runtimeEntry}`);
    }

    await ensureRuntimeDependencies(syncResult);
    await runRuntime();
}

main().catch((error) => {
    console.error('AgentFramework bootstrap 启动失败:', error.message);
    process.exitCode = 1;
});
