#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: node validate-prefab-ids.mjs <prefab-path>');
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function* walk(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walk(item);
    }
    return;
  }

  if (!isObject(value)) {
    return;
  }

  yield value;
  for (const key of Object.keys(value)) {
    yield* walk(value[key]);
  }
}

const target = process.argv[2];
if (!target) {
  usage();
  process.exit(2);
}

const resolvedPath = path.resolve(target);
if (!fs.existsSync(resolvedPath)) {
  console.error(`[FAIL] File not found: ${resolvedPath}`);
  process.exit(1);
}

let root;
try {
  const raw = fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '');
  root = JSON.parse(raw);
} catch (error) {
  console.error(`[FAIL] Invalid JSON: ${resolvedPath}`);
  console.error(String(error));
  process.exit(1);
}

if (!Array.isArray(root)) {
  console.error('[FAIL] Prefab root must be a JSON array.');
  process.exit(1);
}

if (root.length === 0) {
  console.error('[FAIL] Prefab array is empty.');
  process.exit(1);
}

const errors = [];
const prefab = root[0];
if (!isObject(prefab) || prefab.__type__ !== 'cc.Prefab') {
  errors.push('Index 0 must be an object with "__type__": "cc.Prefab".');
}

const rootNodeId = prefab?.data?.__id__;
if (!Number.isInteger(rootNodeId)) {
  errors.push('cc.Prefab.data.__id__ must be an integer.');
} else if (rootNodeId < 0 || rootNodeId >= root.length) {
  errors.push(`cc.Prefab.data.__id__ out of range: ${rootNodeId}`);
}

const badRefs = [];
for (const node of walk(root)) {
  if (!Object.prototype.hasOwnProperty.call(node, '__id__')) {
    continue;
  }
  const value = node.__id__;
  if (!Number.isInteger(value) || value < 0 || value >= root.length) {
    badRefs.push(value);
  }
}

if (badRefs.length > 0) {
  const unique = [...new Set(badRefs)];
  errors.push(`Found out-of-range __id__ references: ${unique.join(', ')}`);
}

if (errors.length > 0) {
  console.error(`[FAIL] ${resolvedPath}`);
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`[OK] ${resolvedPath}`);
console.log(`- objects: ${root.length}`);
console.log('- all __id__ references are in range');
