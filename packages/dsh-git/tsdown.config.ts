import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/types.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
  external: [/^@deepseek-ai\//, 'zod'],
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
})
