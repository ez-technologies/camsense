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

/**
 * How far `img` has moved against `ref` (both grey, same size), in pixels, for a hand that shook a
 * little between frames. Edges are compared rather than brightness, since frames focused differently
 * differ in brightness detail but not in where the edges are. Coarse to fine: a search on a picture an
 * eighth the size, then refined at a quarter, a half and full size.
 */
export function estimateShift(ref: Float32Array, img: Float32Array, w: number, h: number, maxShift = 48): { dx: number; dy: number } {
  const pyramid = new Map<number, { a: Float32Array; b: Float32Array; sw: number; sh: number }>()
  const level = (f: number) => {
    if (!pyramid.has(f)) {
      const sw = Math.floor(w / f)
      const sh = Math.floor(h / f)
      pyramid.set(f, { a: edges(shrink(ref, w, h, f), sw, sh), b: edges(shrink(img, w, h, f), sw, sh), sw, sh })
    }
    return pyramid.get(f)!
  }
  /** Mean difference of edges with `img` moved by (ox, oy) at scale 1/f. */
  const cost = (f: number, ox: number, oy: number, margin: number) => {
    const { a, b, sw, sh } = level(f)
    let sum = 0
    let count = 0
    for (let y = margin + 2; y < sh - margin - 2; y += 2) {
      for (let x = margin + 2; x < sw - margin - 2; x += 2) {
        const yy = y + oy
        const xx = x + ox
        if (yy < 0 || yy >= sh || xx < 0 || xx >= sw) continue
        sum += Math.abs(a[y * sw + x] - b[yy * sw + xx])
        count++
      }
    }
    return sum / Math.max(1, count)
  }
  /** Around a guess (pixels of full size), the best shift at scale 1/f within ±r steps. */
  const around = (g: { dx: number; dy: number }, f: number, r: number) => {
    const cx = Math.round(g.dx / f)
    const cy = Math.round(g.dy / f)
    let best = { dx: g.dx, dy: g.dy, c: Infinity }
    for (let oy = cy - r; oy <= cy + r; oy++)
      for (let ox = cx - r; ox <= cx + r; ox++) {
        const v = cost(f, ox, oy, r)
        if (v < best.c) best = { dx: ox * f, dy: oy * f, c: v }
      }
    return best
  }
  /** Keeps the best few guesses at each finer scale, so full size is only reached by three. */
  const narrow = (guesses: { dx: number; dy: number }[]) => {
    let g = guesses.map((k) => around(k, 4, 2)).sort((p, q) => p.c - q.c).slice(0, 6)
    g = g.map((k) => around(k, 2, 2)).sort((p, q) => p.c - q.c).slice(0, 3)
    return g.map((k) => around(k, 1, 1))
  }
  // Coarse search at an eighth of the size, keeping several candidates: rows of text repeat, and at
  // this size a shift of one whole line can fit better than the true one only because it lands on the
  // coarse grid. Each candidate is refined to full size before choosing.
  const range = Math.ceil(maxShift / 8)
  const coarse: { x: number; y: number; c: number }[] = []
  for (let oy = -range; oy <= range; oy++) for (let ox = -range; ox <= range; ox++) coarse.push({ x: ox, y: oy, c: cost(8, ox, oy, range) })
  coarse.sort((p, q) => p.c - q.c)
  // The best few, and always every small shift (up to 16 pixels each way): on a page of text many far
  // shifts look alike and can crowd the true, small one out of the best few.
  const picked = [...coarse.slice(0, 8), ...coarse.filter((k) => Math.abs(k.x) <= 2 && Math.abs(k.y) <= 2)]
  const unique = picked.filter((k, i) => picked.findIndex((q) => q.x === k.x && q.y === k.y) === i)
  const finals = narrow(unique.map((k) => ({ dx: k.x * 8, dy: k.y * 8 })))
  // A hand that shakes moves little: of the shifts within 3% of the best, the smallest wins.
  const bestCost = Math.min(...finals.map((f) => f.c))
  const chosen = finals
    .filter((f) => f.c <= bestCost * 1.03)
    .reduce((p, q) => (Math.hypot(q.dx, q.dy) < Math.hypot(p.dx, p.dy) ? q : p))
  return { dx: chosen.dx, dy: chosen.dy }
}

function shrink(g: Float32Array, w: number, h: number, f: number): Float32Array {
  const sw = Math.floor(w / f)
  const sh = Math.floor(h / f)
  const out = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) sum += g[(y * f + j) * w + x * f + i]
      out[y * sw + x] = sum / (f * f)
    }
  }
  return out
}

function edges(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      out[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w])
    }
  }
  return out
}

/** A copy of `c` moved back by (dx, dy), so it lines up with the reference frame. */
function shifted(c: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  if (!dx && !dy) return c
  const o = document.createElement('canvas')
  o.width = c.width
  o.height = c.height
  const ctx = o.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(c, 0, 0)
  ctx.drawImage(c, -dx, -dy)
  return o
}

function grayOf(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  const g = new Float32Array(c.width * c.height)
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return g
}

/**
 * Merges frames of one size. A hand that shook a little between frames is undone first: each frame is
 * moved to line up with the middle one (`align`, up to `maxShift` pixels).
 */
export function stackFocus(input: HTMLCanvasElement[], tile = 32, align = true, maxShift = 48): StackResult & { shifts: { dx: number; dy: number }[] } {
  const w = input[0].width
  const h = input[0].height
  const grays = input.map(grayOf)
  const ref = Math.floor(input.length / 2)
  const shifts = input.map((_, i) => (align && i !== ref ? estimateShift(grays[ref], grays[i], w, h, maxShift) : { dx: 0, dy: 0 }))
  const frames = input.map((f, i) => shifted(f, shifts[i].dx, shifts[i].dy))
  const sharp = frames.map((f, i) => tileSharpness(shifts[i].dx || shifts[i].dy ? grayOf(f) : grays[i], w, h, tile))
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
  return { canvas: out, choice, tilesX: tx, tilesY: ty, share: share.map((c) => Math.round((c / (tx * ty)) * 100) / 100), shifts }
}
