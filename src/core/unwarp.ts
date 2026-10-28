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

/**
 * The page alone: the flattened picture still has a narrow band of background at its edges (the seat,
 * a sheet under the page). Rows and columns are trimmed from each side while less than `paper` of their
 * pixels are page-bright, and never more than `maxTrim` of the size from a side: a dark band printed
 * on the page (a header) must not be taken for background.
 */
export function cropToPage(src: HTMLCanvasElement, paper = 0.4, maxTrim = 0.1): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  const g = new Uint8Array(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0; i < g.length; i++) {
    g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000
    hist[g[i]]++
  }
  let acc = 0
  let p70 = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= g.length * 0.7) {
      p70 = v
      break
    }
  }
  const bright = Math.max(90, p70 - 60)
  const rowShare = (y: number, x0: number, x1: number) => {
    let n = 0
    for (let x = x0; x < x1; x++) if (g[y * w + x] >= bright) n++
    return n / Math.max(1, x1 - x0)
  }
  const colShare = (x: number, y0: number, y1: number) => {
    let n = 0
    for (let y = y0; y < y1; y++) if (g[y * w + x] >= bright) n++
    return n / Math.max(1, y1 - y0)
  }
  let top = 0
  let bottom = h - 1
  let left = 0
  let right = w - 1
  // Trim in turns, so each side is judged on the part of the picture still kept.
  const capY = Math.round(h * maxTrim)
  const capX = Math.round(w * maxTrim)
  for (let pass = 0; pass < 2; pass++) {
    while (top < capY && rowShare(top, left, right) < paper) top++
    while (bottom > h - 1 - capY && rowShare(bottom, left, right) < paper) bottom--
    while (left < capX && colShare(left, top, bottom) < paper) left++
    while (right > w - 1 - capX && colShare(right, top, bottom) < paper) right--
  }
  // Nothing sensible found (a dark page): keep the picture as it is.
  if (right - left < w * 0.3 || bottom - top < h * 0.3) return src
  const o = document.createElement('canvas')
  o.width = right - left + 1
  o.height = bottom - top + 1
  o.getContext('2d')!.drawImage(src, left, top, o.width, o.height, 0, 0, o.width, o.height)
  return o
}
