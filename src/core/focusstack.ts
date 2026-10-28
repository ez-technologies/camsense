// Focus stacking: frames of the same still scene, each focused at a different distance, merged so that
// every part of the picture comes from the frame where it is sharpest. For a page photographed at a
// slant, where no single focus covers the near and the far end.

export interface StackResult {
  canvas: HTMLCanvasElement
  /** Per tile (row by row), the frame it mostly came from. */
  choice: number[]
  tilesX: number
  tilesY: number
  /** Share of the picture each frame contributed most to. */
  share: number[]
}

/** Sharpness of each tile: mean squared Laplacian of the grey picture. */
export function tileSharpness(gray: Float32Array, w: number, h: number, tile: number): { values: Float32Array; tx: number; ty: number } {
  const tx = Math.ceil(w / tile)
  const ty = Math.ceil(h / tile)
  const values = new Float32Array(tx * ty)
  const counts = new Uint32Array(tx * ty)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      const t = ((y / tile) | 0) * tx + ((x / tile) | 0)
      values[t] += lap * lap
      counts[t]++
    }
  }
  for (let t = 0; t < values.length; t++) values[t] /= Math.max(1, counts[t])
  return { values, tx, ty }
}

/**
 * Per pixel, a weight for each frame: its tile sharpness raised to `power` (so the sharpest frame
 * dominates), interpolated smoothly between tile centres so there are no seams, normalised to 1.
 */
export function blendWeights(sharp: Float32Array[], tx: number, ty: number, power = 4): Float32Array[] {
  const n = sharp.length
  const out = sharp.map(() => new Float32Array(tx * ty))
  for (let t = 0; t < tx * ty; t++) {
    let sum = 0
    let max = 0
    for (let f = 0; f < n; f++) max = Math.max(max, sharp[f][t])
    for (let f = 0; f < n; f++) {
      const v = max > 0 ? (sharp[f][t] / max) ** power : 1 / n
      out[f][t] = v
      sum += v
    }
    for (let f = 0; f < n; f++) out[f][t] /= sum || 1
  }
  return out
}

function grayOf(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  const g = new Float32Array(c.width * c.height)
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return g
}

/** Merges frames of one size; the phone is assumed steady (no alignment). */
export function stackFocus(frames: HTMLCanvasElement[], tile = 32): StackResult {
  const w = frames[0].width
  const h = frames[0].height
  const sharp = frames.map((f) => tileSharpness(grayOf(f), w, h, tile))
  const { tx, ty } = sharp[0]
  const weights = blendWeights(
    sharp.map((s) => s.values),
    tx,
    ty,
  )
  const pixels = frames.map((f) => f.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const n = frames.length
  const wAt = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    // Position between tile centres, for a smooth (bilinear) weight.
    const gy = Math.min(ty - 1, Math.max(0, y / tile - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(ty - 1, y0 + 1)
    const fy = gy - y0
    for (let x = 0; x < w; x++) {
      const gx = Math.min(tx - 1, Math.max(0, x / tile - 0.5))
      const x0 = Math.floor(gx)
      const x1 = Math.min(tx - 1, x0 + 1)
      const fx = gx - x0
      let total = 0
      for (let f = 0; f < n; f++) {
        const m = weights[f]
        const v =
          (m[y0 * tx + x0] * (1 - fx) + m[y0 * tx + x1] * fx) * (1 - fy) + (m[y1 * tx + x0] * (1 - fx) + m[y1 * tx + x1] * fx) * fy
        wAt[f] = v
        total += v
      }
      const i = (y * w + x) * 4
      for (let ch = 0; ch < 3; ch++) {
        let v = 0
        for (let f = 0; f < n; f++) v += pixels[f][i + ch] * wAt[f]
        img.data[i + ch] = v / (total || 1)
      }
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const choice: number[] = []
  const share = new Array(n).fill(0)
  for (let t = 0; t < tx * ty; t++) {
    let best = 0
    for (let f = 1; f < n; f++) if (sharp[f].values[t] > sharp[best].values[t]) best = f
    choice.push(best)
    share[best]++
  }
  return { canvas: out, choice, tilesX: tx, tilesY: ty, share: share.map((c) => Math.round((c / (tx * ty)) * 100) / 100) }
}
