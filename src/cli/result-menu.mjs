import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { selectMenu, isInteractiveTerminal } from './menu.mjs';

export const POST_SYNC_ACTIONS = {
  EXIT: 'exit',
  CONTINUE: 'continue',
  RETRY: 'retry',
  GIT_STATUS: 'git-status',
  DETAILS: 'details',
};

function formatError(error) {
  if (!error) return '';
  return error.message || String(error);
}

function getAfterMessages(packages = []) {
  const messages = [];
  for (const pkg of packages) {
    for (const target of pkg.targets || []) {
      if (target.after && !messages.includes(target.after)) messages.push(target.after);
    }
  }
  return messages;
}

function getGitResultText(gitResult) {
  if (!gitResult) return '未执行';

  if (gitResult.status === 'committed-and-pushed') {
    return `已自动提交并推送：${gitResult.message}`;
  }

  if (gitResult.status === 'skipped') {
    return `已跳过：${gitResult.reason}`;
  }

  return gitResult.message || gitResult.status || '未知';
}

export function buildSyncResultText(result) {
  const lines = [];
  lines.push('====================================');
  lines.push('       AgentFramework Sync Result');
  lines.push('====================================');

  if (result.cancelled) {
    lines.push('状态: 已取消');
  } else {
    lines.push(`状态: ${result.success ? '成功' : '失败'}`);
  }

  if (result.stage) lines.push(`阶段: ${result.stage}`);
  if (result.projectDir) lines.push(`目标项目: ${result.projectDir}`);
  if (result.sourceMode) lines.push(`来源模式: ${result.sourceMode}`);
  if (result.repoRoot) lines.push(`同步源: ${result.repoRoot}`);
  lines.push('');

  if (result.packages?.length) {
    lines.push('同步内容:');
    for (const pkg of result.packages) {
      lines.push(`- ${pkg.title}`);
    }
    lines.push('');
  }

  if (result.syncedTargets?.length) {
    lines.push('文件结果:');
    for (const target of result.syncedTargets) {
      const marker = target.skipped ? '-' : '✓';
      const status = target.skipped ? '已跳过（源和目标相同）' : '已同步';
      lines.push(`  ${marker} ${status}: ${target.from || target.sourcePath} -> ${target.to || target.targetPath}`);
    }
    lines.push('');
  }

  if (result.gitResult) {
    lines.push(`Git: ${getGitResultText(result.gitResult)}`);
    lines.push('');
  }

  const afterMessages = getAfterMessages(result.packages);
  if (afterMessages.length) {
    lines.push('后续提示:');
    for (const message of afterMessages) lines.push(`  - ${message}`);
    lines.push('');
  }

  if (!result.success && result.error) {
    lines.push('错误信息:');
    lines.push(`  ${formatError(result.error)}`);
    lines.push('');
  }

  if (result.hints?.length) {
    lines.push('建议:');
    for (const hint of result.hints) lines.push(`  - ${hint}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function printSyncResult(result) {
  console.log(buildSyncResultText(result));
}

export async function waitForEnter(message = '按 Enter 返回...') {
  if (!isInteractiveTerminal()) return;
  const rl = createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

export async function selectPostSyncAction(result, { noResultMenu = false } = {}) {
  const resultText = buildSyncResultText(result);

  if (noResultMenu || !isInteractiveTerminal()) {
    console.log(resultText);
    return POST_SYNC_ACTIONS.EXIT;
  }

  const items = result.success && !result.cancelled
    ? [
        { key: 'continue', label: '继续同步其他内容', value: POST_SYNC_ACTIONS.CONTINUE },
        { key: 'status', label: '查看 Git 状态', value: POST_SYNC_ACTIONS.GIT_STATUS },
        { key: 'retry', label: '重新执行本次同步', value: POST_SYNC_ACTIONS.RETRY },
        { key: 'exit', label: '退出', value: POST_SYNC_ACTIONS.EXIT },
      ]
    : [
        { key: 'retry', label: '重试', value: POST_SYNC_ACTIONS.RETRY },
        { key: 'details', label: '查看错误详情', value: POST_SYNC_ACTIONS.DETAILS },
        { key: 'status', label: '查看 Git 状态', value: POST_SYNC_ACTIONS.GIT_STATUS },
        { key: 'exit', label: '退出', value: POST_SYNC_ACTIONS.EXIT },
      ];

  return await selectMenu(`${resultText}\n\n请选择下一步操作：`, items, '请输入序号: ') || POST_SYNC_ACTIONS.EXIT;
}
