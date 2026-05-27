import process, { stdout as output } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { flattenSyncCatalog } from '../sync/catalog.mjs';

const STEP_TITLES = {
  category: '选择一级文件夹',
  content: '选择具体内容',
  confirm: '确认同步',
};

function hideCursor() {
  output.write('\x1b[?25l');
}

function showCursor() {
  output.write('\x1b[?25h');
}

function enterAlternateScreen() {
  output.write('\x1b[?1049h');
}

function leaveAlternateScreen() {
  output.write('\x1b[?1049l');
}

function clearScreen() {
  output.write('\x1b[2J\x1b[0f');
}

function writeHeader(context) {
  console.log('====================================');
  console.log('       AgentFramework Sync');
  console.log('====================================');
  console.log(`目标项目: ${context.projectDir}`);
  console.log(`来源模式: ${context.sourceMode}`);
  console.log(`同步源: ${context.repoRoot}`);
  console.log('');
}

function writeSteps(step) {
  const steps = ['category', 'content', 'confirm'];
  console.log(`步骤: ${steps.map((item) => (item === step ? `[${STEP_TITLES[item]}]` : STEP_TITLES[item])).join(' > ')}`);
  console.log('');
}

function writeOptions(items, selectedIndex) {
  items.forEach((item, index) => {
    const marker = index === selectedIndex ? '❯' : ' ';
    console.log(` ${marker} ${item.label}`);
  });
}

function writePlan(packages) {
  console.log('将全量覆盖同步以下文件或目录：');
  for (const pkg of packages) {
    console.log(`- ${pkg.title}`);
    for (const target of pkg.targets) {
      console.log(`  ${target.from} -> ${target.to}`);
    }
  }
}

function getCategoryOptions(catalog) {
  return [
    ...catalog.map((category) => ({
      key: category.name,
      label: `${category.name}/ - ${category.title}（${category.items.length} 项）`,
      value: category,
    })),
    { key: 'all', label: 'all - 全部一级文件夹', value: 'all' },
  ];
}

function getContentOptions(category) {
  return [
    ...category.items.map((pkg) => ({
      key: pkg.entryName,
      keys: [pkg.key, pkg.name],
      label: `${pkg.entryName} - ${pkg.description}`,
      value: [pkg],
    })),
    { key: 'all', keys: [`${category.name}/all`], label: `all - ${category.name}/ 下全部内容`, value: category.items },
  ];
}

function getConfirmOptions() {
  return [
    { key: 'yes', label: '继续同步', value: true },
    { key: 'no', label: '取消同步', value: false },
  ];
}

export async function selectSyncPlan({ catalog, context, assumeYes = false }) {
  return await new Promise((resolve) => {
    let step = 'category';
    let selectedCategory;
    let selectedPackages;
    let categoryIndex = 0;
    let contentIndex = 0;
    let confirmIndex = 0;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKeypress);
      if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      showCursor();
      leaveAlternateScreen();
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const currentItems = () => {
      if (step === 'category') return getCategoryOptions(catalog);
      if (step === 'content') return getContentOptions(selectedCategory);
      return getConfirmOptions();
    };

    const currentIndex = () => {
      if (step === 'category') return categoryIndex;
      if (step === 'content') return contentIndex;
      return confirmIndex;
    };

    const setCurrentIndex = (value) => {
      if (step === 'category') categoryIndex = value;
      else if (step === 'content') contentIndex = value;
      else confirmIndex = value;
    };

    const move = (delta) => {
      const items = currentItems();
      setCurrentIndex((currentIndex() + delta + items.length) % items.length);
      render();
    };

    const goBack = () => {
      if (step === 'content') {
        step = 'category';
        render();
        return;
      }
      if (step === 'confirm') {
        step = selectedCategory === 'all' ? 'category' : 'content';
        render();
      }
    };

    const choose = () => {
      const items = currentItems();
      const choice = items[currentIndex()];
      if (!choice) return;

      if (step === 'category') {
        selectedCategory = choice.value;
        contentIndex = 0;
        confirmIndex = 0;
        if (selectedCategory === 'all') {
          selectedPackages = flattenSyncCatalog(catalog);
          if (assumeYes) {
            finish({ packages: selectedPackages, confirmed: true });
            return;
          }
          step = 'confirm';
        } else {
          step = 'content';
        }
        render();
        return;
      }

      if (step === 'content') {
        selectedPackages = choice.value;
        confirmIndex = 0;
        if (assumeYes) {
          finish({ packages: selectedPackages, confirmed: true });
          return;
        }
        step = 'confirm';
        render();
        return;
      }

      if (step === 'confirm') {
        finish(choice.value ? { packages: selectedPackages, confirmed: true } : undefined);
      }
    };

    const render = () => {
      clearScreen();
      hideCursor();
      writeHeader(context);
      writeSteps(step);

      if (step === 'category') {
        console.log('请选择一级文件夹：');
        console.log('');
        writeOptions(currentItems(), categoryIndex);
        console.log('');
        console.log('↑↓ 选择，Enter 确认，Esc 取消');
        return;
      }

      if (step === 'content') {
        console.log(`当前: ${selectedCategory.name}/`);
        console.log('');
        console.log(`请选择 ${selectedCategory.name}/ 下要同步的内容：`);
        console.log('');
        writeOptions(currentItems(), contentIndex);
        console.log('');
        console.log('↑↓ 选择，Enter 确认，Backspace 返回，Esc 取消');
        return;
      }

      writePlan(selectedPackages);
      console.log('');
      writeOptions(currentItems(), confirmIndex);
      console.log('');
      console.log('↑↓ 选择，Enter 确认，Backspace 返回，Esc 取消');
    };

    const onKeypress = (_str, key) => {
      if (!key) return;
      if (key.name === 'up') {
        move(-1);
        return;
      }
      if (key.name === 'down') {
        move(1);
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        choose();
        return;
      }
      if (key.name === 'backspace') {
        goBack();
        return;
      }
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        finish(undefined);
        return;
      }
      if (key.name && /^[1-9]$/.test(key.name)) {
        const index = Number(key.name) - 1;
        if (index >= 0 && index < currentItems().length) {
          setCurrentIndex(index);
          render();
        }
      }
    };

    enterAlternateScreen();
    emitKeypressEvents(process.stdin);
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
    render();
  });
}
