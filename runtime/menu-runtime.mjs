#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(rootDir, '.agents', 'skills');

const templateCatalog = [
    {
        value: 'cocos-developer-template',
        title: 'Cocos 开发模板',
        description: '适用于 Cocos 开发场景，强调稳定实现、日志、文档与极简改动。',
        items: [
            'cocos-developer',
            'cocos-general',
            'cocos-code-review',
            'chinese-encoding',
        ],
    },
];

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const projectDir = process.env.AGENTFRAMEWORK_TARGET_DIR || process.cwd();
const runtimeSkillsDir = path.join(rootDir, '.agents', 'skills');
const pullTemplateArg = rawArgs.find((arg) => arg.startsWith('--pull-template='))?.slice('--pull-template='.length);

function getProjectSkillsDir() {
    return path.join(projectDir, '.agents', 'skills');
}

function getProjectTemplateLockPath() {
    return path.join(projectDir, '.agents', 'template-lock.json');
}

function getProjectAgentsPath() {
    return path.join(projectDir, 'AGENTS.md');
}

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function ensureDir(targetPath) {
    await fs.mkdir(targetPath, { recursive: true });
}

function buildAgentsTemplate(selected) {
    const skillList = selected.items.map((item) => `- ${item}`).join('\n');
    return `# AGENTS\n\n## Base Skills\n\n${skillList}\n\n## Notes\n\n- Skills are synced from AgentFramework into .agents/skills.\n- Add project-specific rules here instead of editing the synced skill files.\n`;
}

async function syncSkillToProject(skillName) {
    const sourceDir = path.join(runtimeSkillsDir, skillName);
    const targetDir = path.join(getProjectSkillsDir(), skillName);

    if (!await pathExists(sourceDir)) {
        throw new Error(`未找到 skill: ${skillName}`);
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
}

async function writeTemplateLock(selected) {
    const payload = {
        template: selected.value,
        title: selected.title,
        skills: selected.items,
        runtimeRoot: rootDir,
        installedAt: new Date().toISOString(),
    };

    await fs.writeFile(getProjectTemplateLockPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function ensureProjectAgentsFile(selected) {
    const agentsPath = getProjectAgentsPath();
    if (await pathExists(agentsPath)) {
        return false;
    }

    await fs.writeFile(agentsPath, buildAgentsTemplate(selected), 'utf8');
    return true;
}

async function applyTemplateToProject(selected) {
    await ensureDir(getProjectSkillsDir());

    for (const skillName of selected.items) {
        await syncSkillToProject(skillName);
    }

    await writeTemplateLock(selected);
    const createdAgents = await ensureProjectAgentsFile(selected);

    return {
        skillsDir: getProjectSkillsDir(),
        templateLockPath: getProjectTemplateLockPath(),
        agentsPath: getProjectAgentsPath(),
        createdAgents,
    };
}

async function readInstalledSkills() {
    try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

function printHeader(installedSkills) {
    console.clear();
    console.log('====================================');
    console.log('         AgentFramework Menu        ');
    console.log('====================================');
    console.log(`当前目录: ${process.cwd()}`);
    console.log(`runtime 仓库: ${rootDir}`);
    console.log(`已发现 skills: ${installedSkills.length}`);
    console.log('');
}

async function showTemplateCatalog() {
    console.log('可用模板：');
    for (const template of templateCatalog) {
        console.log(`- ${template.title}`);
        console.log(`  ${template.description}`);
        console.log(`  包含: ${template.items.join(', ')}`);
    }
    console.log('');
}

async function showInstalledSkills(installedSkills) {
    console.log('当前 runtime 中可用的 skills：');
    if (installedSkills.length === 0) {
        console.log('- 暂未发现 skill');
    } else {
        for (const skill of installedSkills) {
            console.log(`- ${skill}`);
        }
    }
    console.log('');
}

async function handleTemplateSelection() {
    const { template } = await prompts({
        type: 'select',
        name: 'template',
        message: '请选择要拉取的模板',
        choices: templateCatalog.map((item) => ({
            title: item.title,
            description: item.description,
            value: item.value,
        })),
    }, {
        onCancel: () => {
            throw new Error('cancelled');
        },
    });

    const selected = templateCatalog.find((item) => item.value === template);
    if (!selected) {
        console.log('未找到所选模板。');
        return;
    }

    console.log('');
    console.log(`已选择模板: ${selected.title}`);
    console.log(`说明: ${selected.description}`);
    console.log(`将包含: ${selected.items.join(', ')}`);
    console.log('');

    const result = await applyTemplateToProject(selected);

    console.log(`已同步到项目目录: ${projectDir}`);
    console.log(`skills 目录: ${result.skillsDir}`);
    console.log(`模板记录: ${result.templateLockPath}`);
    if (result.createdAgents) {
        console.log(`已生成项目说明: ${result.agentsPath}`);
    } else {
        console.log(`保留现有项目说明: ${result.agentsPath}`);
    }
    console.log('');
}

async function main() {
    const installedSkills = await readInstalledSkills();

    if (pullTemplateArg) {
        const selected = templateCatalog.find((item) => item.value === pullTemplateArg);
        if (!selected) {
            throw new Error(`未找到模板: ${pullTemplateArg}`);
        }

        const result = await applyTemplateToProject(selected);
        console.log(`已同步到项目目录: ${projectDir}`);
        console.log(`skills 目录: ${result.skillsDir}`);
        console.log(`模板记录: ${result.templateLockPath}`);
        if (result.createdAgents) {
            console.log(`已生成项目说明: ${result.agentsPath}`);
        } else {
            console.log(`保留现有项目说明: ${result.agentsPath}`);
        }
        return;
    }

    if (args.has('--list-templates')) {
        await showTemplateCatalog();
        return;
    }

    if (args.has('--list-skills')) {
        await showInstalledSkills(installedSkills);
        return;
    }

    printHeader(installedSkills);

    try {
        while (true) {
            const { action } = await prompts({
                type: 'select',
                name: 'action',
                message: '请选择操作',
                choices: [
                    { title: '拉取模板到当前项目', value: 'pull-template' },
                    { title: '查看可用模板', value: 'list-templates' },
                    { title: '查看当前 runtime 可用 skills', value: 'list-skills' },
                    { title: '退出', value: 'exit' },
                ],
            }, {
                onCancel: () => {
                    throw new Error('cancelled');
                },
            });

            console.log('');

            if (action === 'pull-template') {
                await handleTemplateSelection();
            } else if (action === 'list-templates') {
                await showTemplateCatalog();
            } else if (action === 'list-skills') {
                await showInstalledSkills(installedSkills);
            } else if (action === 'exit') {
                console.log('已退出 AgentFramework Menu。');
                break;
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message === 'cancelled') {
            console.log('\n已取消操作。');
            return;
        }
        throw error;
    }
}

main().catch((error) => {
    console.error('CLI runtime 启动失败:', error);
    process.exitCode = 1;
});
