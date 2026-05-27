#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli/main.mjs';

const BIN_PATH = fileURLToPath(import.meta.url);
const FRAMEWORK_ROOT = path.resolve(path.dirname(BIN_PATH), '..');

main({
  rawArgs: process.argv.slice(2),
  projectDir: process.cwd(),
  repoRoot: FRAMEWORK_ROOT,
  sourceMode: process.env.AGENTFRAMEWORK_SOURCE_MODE || 'local',
  entryScriptPath: process.env.AGENTFRAMEWORK_ENTRY_SCRIPT,
}).catch((error) => {
  console.error('同步失败:', error.message);
  process.exitCode = 1;
});
