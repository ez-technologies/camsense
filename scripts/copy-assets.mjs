#!/usr/bin/env node
// Copies what camsense loads at run time into a folder the app serves: the PaddleOCR models and the
// ONNX Runtime WebAssembly files (the plain one, and the one for WebGPU), and the barcode reader for
// browsers that have none of their own.
// Usage: camsense-copy-assets <folder>   (then call setAssetsBase('/<that folder's URL>/'))
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dest = process.argv[2]
if (!dest) {
  console.error('usage: camsense-copy-assets <folder>')
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
const models = join(here, '..', 'models')
for (const f of readdirSync(models)) copyFileSync(join(models, f), join(dest, f))
// The package exports each WebAssembly file by name.
const require = createRequire(import.meta.url)
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync(require.resolve(`onnxruntime-web/${f}`), join(dest, f))
}
// The barcode reader for browsers without their own (iPhone): ZXing in WebAssembly, loaded only there.
copyFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'), join(dest, 'zxing_reader.wasm'))
console.log(`camsense assets copied to ${dest}`)
