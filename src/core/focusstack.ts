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
export function estimateShift(ref: Float32Array, img: Float32Array, w: number, h: number, maxShift = 48): { dx: number; dy: number; c: number } {
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
  return { dx: chosen.dx, dy: chosen.dy, c: chosen.c }
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

function grayOf(c: HTMLCanvasElement): Float32Array {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  const g = new Float32Array(c.width * c.height)
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return g
}

export interface FrameFit {
  /** Kept in the merge; false when blurred everywhere or not lining up with the others. */
  used: boolean
  why?: 'blurred' | 'mismatch'
  /** Size change (focus breathing: the picture grows a little as the lens focuses nearer) and move. */
  scale: number
  dx: number
  dy: number
  /** How well its edges match the reference frame after lining up (1 = the same). */
  match: number
}

export interface StackOptions {
  tile?: number
  align?: boolean
  maxShift?: number
  /** Frames are merged at this longest side (merging at full camera size is slow on a phone). */
  maxSide?: number
  /** Size changes tried for focus breathing. */
  scales?: number[]
  /** Below this edge match a frame is left out rather than risk doubled text. */
  minMatch?: number
}

function resized(c: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(c.width, c.height))
  if (k === 1) return c
  const o = document.createElement('canvas')
  o.width = Math.round(c.width * k)
  o.height = Math.round(c.height * k)
  const ctx = o.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(c, 0, 0, o.width, o.height)
  return o
}

/** `c` grown by `scale` about its centre and moved back by (dx, dy). */
function transformed(c: HTMLCanvasElement, scale: number, dx: number, dy: number): HTMLCanvasElement {
  if (scale === 1 && !dx && !dy) return c
  const o = document.createElement('canvas')
  o.width = c.width
  o.height = c.height
  const ctx = o.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(c, 0, 0)
  ctx.translate(c.width / 2 - dx, c.height / 2 - dy)
  ctx.scale(1 / scale, 1 / scale)
  ctx.drawImage(c, -c.width / 2, -c.height / 2)
  return o
}

/** Correlation (-1..1) of two edge maps of the same size, on an eighth-size copy. */
function edgeMatch(a: Float32Array, b: Float32Array, w: number, h: number): number {
  const sw = Math.floor(w / 8)
  const sh = Math.floor(h / 8)
  const ea = edges(shrink(a, w, h, 8), sw, sh)
  const eb = edges(shrink(b, w, h, 8), sw, sh)
  let ma = 0
  let mb = 0
  const n = sw * sh
  for (let i = 0; i < n; i++) {
    ma += ea[i]
    mb += eb[i]
  }
  ma /= n
  mb /= n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const x = ea[i] - ma
    const y = eb[i] - mb
    sab += x * y
    saa += x * x
    sbb += y * y
  }
  return sab / Math.sqrt(saa * sbb || 1)
}

/**
 * Merges frames of one scene focused at different distances:
 * 1. shrinks them to `maxSide`;
 * 2. leaves out frames blurred everywhere (taken while the lens was still moving);
 * 3. lines each frame up with the sharpest one, for size (focus breathing) and move (a shaking hand);
 * 4. leaves out frames whose edges still do not match (better a softer region than doubled text);
 * 5. merges tile by tile, each part from its sharpest frame.
 */
export function stackFocus(input: HTMLCanvasElement[], o: StackOptions = {}): StackResult & { fits: FrameFit[]; shifts: { dx: number; dy: number }[] } {
  const tile = o.tile ?? 32
  const sized = input.map((c) => resized(c, o.maxSide ?? 2000))
  const w = sized[0].width
  const h = sized[0].height
  const grays = sized.map(grayOf)
  // Overall sharpness of each frame: the sharpest of its 6x6 regions, and the median of them.
  const region = Math.ceil(Math.max(w, h) / 6)
  const overall = grays.map((g) => {
    const v = [...tileSharpness(g, w, h, region).values].sort((p, q) => p - q)
    return { max: v[v.length - 1], median: v[Math.floor(v.length / 2)] }
  })
  const maxes = overall.map((x) => x.max).sort((p, q) => p - q)
  const typical = maxes[Math.floor(maxes.length / 2)]
  const ref = overall.reduce((best, x, i) => (x.median > overall[best].median ? i : best), 0)
  const fits: FrameFit[] = sized.map((_, i) =>
    overall[i].max < typical * 0.25 && i !== ref
      ? { used: false, why: 'blurred', scale: 1, dx: 0, dy: 0, match: 0 }
      : { used: true, scale: 1, dx: 0, dy: 0, match: 1 },
  )
  const frames = [...sized]
  if (o.align !== false) {
    // The size change is chosen on quarter-size copies (quick); the move is then found on half-size
    // copies for that size only, and applied at full size.
    const small = (c: HTMLCanvasElement, f: number) => grayOf(resized(c, Math.max(w, h) / f))
    const qw = Math.round(w / 4)
    const qh = Math.round(h / 4)
    const hw = Math.round(w / 2)
    const hh = Math.round(h / 2)
    const refQ = small(sized[ref], 4)
    const refH = small(sized[ref], 2)
    for (let i = 0; i < sized.length; i++) {
      if (i === ref || !fits[i].used) continue
      let pick = { scale: 1, c: Infinity }
      for (const scale of o.scales ?? [0.98, 0.99, 1, 1.01, 1.02]) {
        const sh = estimateShift(refQ, small(transformed(sized[i], scale, 0, 0), 4), qw, qh, (o.maxShift ?? 48) / 4)
        if (sh.c < pick.c) pick = { scale, c: sh.c }
      }
      const sh = estimateShift(refH, small(transformed(sized[i], pick.scale, 0, 0), 2), hw, hh, (o.maxShift ?? 48) / 2)
      const best = { scale: pick.scale, dx: sh.dx * 2, dy: sh.dy * 2 }
      frames[i] = transformed(sized[i], best.scale, best.dx, best.dy)
      const match = Math.round(edgeMatch(grays[ref], grayOf(frames[i]), w, h) * 100) / 100
      fits[i] = { used: match >= (o.minMatch ?? 0.6), why: match >= (o.minMatch ?? 0.6) ? undefined : 'mismatch', scale: best.scale, dx: best.dx, dy: best.dy, match }
    }
  }
  const usedIdx = fits.map((f, i) => (f.used ? i : -1)).filter((i) => i >= 0)
  const merged = mergeTiles(usedIdx.map((i) => frames[i]), tile)
  const share = fits.map(() => 0)
  usedIdx.forEach((i, k) => (share[i] = merged.share[k]))
  return { ...merged, share, fits, shifts: fits.map((f) => ({ dx: f.dx, dy: f.dy })) }
}

/** Tile by tile, each part of the picture from its sharpest frame, with smooth weights between tiles. */
function mergeTiles(frames: HTMLCanvasElement[], tile: number): StackResult {
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
