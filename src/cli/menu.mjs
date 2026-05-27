import fs from 'node:fs';
import process, { stdout as output } from 'node:process';
import { emitKeypressEvents } from 'node:readline';

export function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function clearMenuScreen() {
  output.write('\x1b[2J\x1b[0f');
}

let fallbackAnswers;
let fallbackAnswerIndex = 0;

function readFallbackAnswer() {
  if (!fallbackAnswers) {
    fallbackAnswers = fs.readFileSync(0, 'utf-8').split(/\r?\n/);
  }
  return fallbackAnswers[fallbackAnswerIndex++] || '';
}

export async function selectMenu(message, items, fallbackPrompt) {
  if (!isInteractiveTerminal()) {
    console.log(message);
    items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.label}`);
    });
    console.log('');

    output.write(fallbackPrompt);
    const value = readFallbackAnswer().trim();
    if (!value) return undefined;

    const byNumber = Number(value);
    if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= items.length) {
      return items[byNumber - 1].value;
    }

    const byLabel = items.find((item) => item.label === value || item.key === value || item.keys?.includes(value) || item.value === value);
    return byLabel?.value;
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

export async function confirm(message, assumeYes) {
  if (assumeYes) return true;

  const choice = await selectMenu(message, [
    { label: '继续同步', value: true },
    { label: '取消同步', value: false },
  ], '请输入序号: ');

  return Boolean(choice);
}
