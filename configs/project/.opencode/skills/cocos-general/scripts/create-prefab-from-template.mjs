#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error('Usage:');
  console.error('  node create-prefab-from-template.mjs --output <path> [--name <nodeName>] [--template <path>] [--with-meta] [--backup-suffix <fmt>]');
}

function parseArgs(argv) {
  const args = {
    output: '',
    name: '',
    template: '',
    withMeta: false,
    backupSuffix: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output') {
      args.output = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--name') {
      args.name = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--template') {
      args.template = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--backup-suffix') {
      args.backupSuffix = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--with-meta') {
      args.withMeta = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function formatTimestamp(date) {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function getBackupPath(targetPath, backupSuffix) {
  const timestamp = formatTimestamp(new Date());
  const parsed = path.parse(targetPath);
  const suffixTemplate = backupSuffix || 'bak.{timestamp}';
  const renderedSuffix = suffixTemplate.replaceAll('{timestamp}', timestamp);

  let serial = 0;
  while (true) {
    const suffix = serial === 0 ? renderedSuffix : `${renderedSuffix}.${serial}`;
    const candidate = path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    serial += 1;
  }
}

function assertTemplateShape(root) {
  if (!Array.isArray(root)) {
    throw new Error('Template root must be a JSON array.');
  }
  if (root.length < 3) {
    throw new Error('Template must contain at least 3 objects.');
  }

  const prefab = root[0];
  if (!prefab || prefab.__type__ !== 'cc.Prefab') {
    throw new Error('Template index 0 must be cc.Prefab.');
  }

  const rootNodeId = prefab?.data?.__id__;
  if (!Number.isInteger(rootNodeId)) {
    throw new Error('Template cc.Prefab.data.__id__ must be an integer.');
  }
  if (rootNodeId < 0 || rootNodeId >= root.length) {
    throw new Error(`Template root node id out of range: ${rootNodeId}`);
  }

  const rootNode = root[rootNodeId];
  if (!rootNode || rootNode.__type__ !== 'cc.Node') {
    throw new Error(`Template root object at index ${rootNodeId} must be cc.Node.`);
  }
}

function loadTemplate(templatePath) {
  const raw = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  assertTemplateShape(parsed);
  return parsed;
}

function buildMeta(nodeName) {
  return {
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid: crypto.randomUUID(),
    files: ['.json'],
    subMetas: {},
    userData: {
      syncNodeName: nodeName,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) {
    usage();
    process.exit(2);
  }

  const outputPath = path.resolve(args.output);
  if (path.extname(outputPath).toLowerCase() !== '.prefab') {
    throw new Error(`Output file must end with .prefab: ${outputPath}`);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultTemplatePath = path.resolve(scriptDir, '../assets/templates/node.prefab');
  const templatePath = path.resolve(args.template || defaultTemplatePath);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const prefabJson = loadTemplate(templatePath);
  const prefab = prefabJson[0];
  const rootNode = prefabJson[prefab.data.__id__];
  const nodeName = args.name || path.parse(outputPath).name;

  prefab._name = nodeName;
  rootNode._name = nodeName;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let backupPath = '';
  if (fs.existsSync(outputPath)) {
    backupPath = getBackupPath(outputPath, args.backupSuffix);
    fs.copyFileSync(outputPath, backupPath);
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(prefabJson, null, 2)}\n`, 'utf8');

  let metaPath = '';
  if (args.withMeta) {
    metaPath = `${outputPath}.meta`;
    fs.writeFileSync(metaPath, `${JSON.stringify(buildMeta(nodeName), null, 2)}\n`, 'utf8');
  }

  console.log(`[OK] prefab created: ${outputPath}`);
  console.log(`[OK] template used: ${templatePath}`);
  if (backupPath) {
    console.log(`[OK] backup created: ${backupPath}`);
  }
  if (metaPath) {
    console.log(`[OK] meta created: ${metaPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${String(error)}`);
  process.exit(1);
}
