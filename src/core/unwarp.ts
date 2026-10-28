// Flattening a photographed page with UVDoc (PaddleOCR's document unwarping model, 32 MB): curl,
// folds, creases and tilt are undone region by region (the model predicts a dense grid). Downloaded
// only when used.
import type * as Ort from 'onnxruntime-web'
import { assetsBase } from './ocr/engine'

let session: Promise<{ ort: typeof Ort; s: Ort.InferenceSession }> | null = null

/** The model file; by default `uvdoc.onnx` in the assets folder. */
export function loadUnwarp(url = `${assetsBase()}uvdoc.onnx`) {
  session ??= (async () => {
    const ort = (await import('onnxruntime-web/wasm')) as typeof Ort
    ort.env.wasm.wasmPaths = { wasm: `${assetsBase()}ort-wasm-simd-threaded.wasm` }
    ort.env.wasm.numThreads = 1
    return { ort, s: await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }) }
  })()
  return session
}

/**
 * The page flattened. The picture is shrunk to `maxSide` first (the output keeps that size). Fed as
 * PaddleX feeds it: BGR, 0-1, channels first; the output is BGR 0-1.
 */
export async function unwarpPage(src: HTMLCanvasElement, maxSide = 1600): Promise<HTMLCanvasElement> {
  const { ort, s } = await loadUnwarp()
  const k = Math.min(1, maxSide / Math.max(src.width, src.height))
  const w = Math.round(src.width * k)
  const h = Math.round(src.height * k)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const input = new Float32Array(3 * w * h)
  for (let i = 0; i < w * h; i++) for (let ch = 0; ch < 3; ch++) input[ch * w * h + i] = px[i * 4 + (2 - ch)] / 255
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) })
  const t = out[s.outputNames[0]]
  const [, , oh, ow] = t.dims
  const d = t.data as Float32Array
  const o = document.createElement('canvas')
  o.width = ow
  o.height = oh
  const octx = o.getContext('2d')!
  const img = octx.createImageData(ow, oh)
  for (let i = 0; i < ow * oh; i++) {
    for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = Math.max(0, Math.min(255, d[(2 - ch) * ow * oh + i] * 255))
    img.data[i * 4 + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  return o
}
