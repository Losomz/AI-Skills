#!/usr/bin/env node

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function usage() {
  console.error('Usage: node compress-uuid.mjs <uuid>');
}

function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }

  const prefix = hex.slice(0, 5);
  const rest = hex.slice(5);
  let bits = '';
  for (const ch of rest) {
    const value = Number.parseInt(ch, 16);
    bits += value.toString(2).padStart(4, '0');
  }

  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    const segment = bits.slice(i, i + 6);
    out += ALPHABET[Number.parseInt(segment, 2)];
  }

  return prefix + out;
}

const uuid = process.argv[2];
if (!uuid) {
  usage();
  process.exit(2);
}

try {
  console.log(compressUuid(uuid));
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
