/**
 * Stretch a flattened page so the paper's own outline becomes the picture's rectangle.
 * UVDoc straightens the page as a whole; where an edge is still bent or pulled in (a corner turned
 * over, a crumpled side), each row is stretched between the paper's left and right edges, then each
 * column between its top and bottom edges. Text folded under the paper is not in the picture and
 * cannot come back; this only stretches what is visible.
 */


/** Brightness threshold between paper and background, as in cropToPage. */
function paperLevel(g: Uint8Array): number {
  const hist = new Uint32Array(256)
  for (const v of g) hist[v]++
  let seen = 0
  let p70 = 255
  for (let i = 0; i < 256; i++) {
    seen += hist[i]
    if (seen >= g.length * 0.7) { p70 = i; break }
  }
  return Math.max(90, p70 - 60)
}

/** Box sums of a 0/1 mask: how many set pixels lie within `r` of each pixel. */
function boxCount(m: Uint8Array, w: number, h: number, r: number): Uint32Array {
  const ii = new Uint32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += m[y * w + x]
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row
    }
  }
  const out = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      out[y * w + x] = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0]
    }
  }
  return out
}

/**
 * Background: dark areas too thick to be print (an opening removes text, lines and printed bands)
 * that reach the picture's border.
 */
export function backgroundMask(g: Uint8Array, w: number, h: number, level: number, r: number): Uint8Array {
  const dark = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) dark[i] = g[i] < level ? 1 : 0
  const c1 = boxCount(dark, w, h, r)
  const eroded = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const area = (Math.min(h, y + r + 1) - Math.max(0, y - r)) * (Math.min(w, x + r + 1) - Math.max(0, x - r))
      eroded[y * w + x] = c1[y * w + x] === area ? 1 : 0
    }
  }
  const c2 = boxCount(eroded, w, h, r)
  const thick = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) thick[i] = c2[i] > 0 ? 1 : 0
  const bg = new Uint8Array(w * h)
  const queue: number[] = []
  const seed = (i: number) => { if (thick[i] && !bg[i]) { bg[i] = 1; queue.push(i) } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (queue.length) {
    const i = queue.pop()!
    const x = i % w
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (i >= w) seed(i - w)
    if (i < w * (h - 1)) seed(i + w)
  }
  return bg
}

/** Median then mean smoothing of an edge line; missing values (-1) are filled from their neighbours. */
export function smoothEdge(v: number[], fallback: number, radius: number): number[] {
  const n = v.length
  const known = v.map((x, i) => [i, x] as const).filter(([, x]) => x >= 0)
  if (!known.length) return v.map(() => fallback)
  const filled = v.map((x, i) => {
    if (x >= 0) return x
    let best = known[0]
    for (const k of known) if (Math.abs(k[0] - i) < Math.abs(best[0] - i)) best = k
    return best[1]
  })
  const med = filled.map((_, i) => {
    const w = filled.slice(Math.max(0, i - radius), Math.min(n, i + radius + 1)).sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  const r2 = Math.max(1, radius >> 1)
  return med.map((_, i) => {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - r2); j < Math.min(n, i + r2 + 1); j++) { s += med[j]; c++ }
    return s / c
  })
}

/** For each output position, where to read: the line between edge a and edge b stretched over the side. */
function stretchLine(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number,
  a: number[], b: number[], rows: boolean) {
  const len = rows ? w : h
  const lines = rows ? h : w
  for (let l = 0; l < lines; l++) {
    const span = b[l] - a[l]
    for (let o = 0; o < len; o++) {
      const s = Math.min(len - 1, Math.max(0, a[l] + (o / (len - 1)) * span))
      const s0 = Math.floor(s)
      const s1 = Math.min(len - 1, s0 + 1)
      const f = s - s0
      const i0 = rows ? (l * w + s0) * 4 : (s0 * w + l) * 4
      const i1 = rows ? (l * w + s1) * 4 : (s1 * w + l) * 4
      const d = rows ? (l * w + o) * 4 : (o * w + l) * 4
      for (let c = 0; c < 3; c++) dst[d + c] = src[i0 + c] * (1 - f) + src[i1 + c] * f
      dst[d + 3] = 255
    }
  }
}

/**
 * Stretch the page so its edges meet the picture's edges. `maxPull` limits how far, as a share of the
 * side, an edge may be pulled in before it is taken as background, not a bent edge.
 */
export function stretchToEdges(src: HTMLCanvasElement, maxPull = 0.15): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data
  const g = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  const bg = backgroundMask(g, w, h, paperLevel(g), Math.max(4, Math.round(Math.max(w, h) * 0.012)))
  const capX = Math.round(w * maxPull)
  const capY = Math.round(h * maxPull)
  // An edge is the first paper pixel from the side; a side that is background further than the cap is
  // not a bent edge (the picture missed the page there) and is filled from its neighbours.
  const scan = (n: number, cap: number, at: (k: number) => number, fromEnd: boolean) => {
    for (let k = 0; k <= cap; k++) if (!bg[at(fromEnd ? n - 1 - k : k)]) return fromEnd ? n - 1 - k : k
    return -1
  }
  const left: number[] = []
  const right: number[] = []
  for (let y = 0; y < h; y++) {
    left.push(scan(w, capX, (x) => y * w + x, false))
    right.push(scan(w, capX, (x) => y * w + x, true))
  }
  const top: number[] = []
  const bottom: number[] = []
  for (let x = 0; x < w; x++) {
    top.push(scan(h, capY, (y) => y * w + x, false))
    bottom.push(scan(h, capY, (y) => y * w + x, true))
  }
  const rx = Math.max(3, Math.round(h * 0.04))
  const ry = Math.max(3, Math.round(w * 0.04))
  const L = smoothEdge(left, 0, rx)
  const R = smoothEdge(right, w - 1, rx)
  const T = smoothEdge(top, 0, ry)
  const B = smoothEdge(bottom, h - 1, ry)

  const mid = new Uint8ClampedArray(w * h * 4)
  stretchLine(data, mid, w, h, L, R, true)
  const out = new Uint8ClampedArray(w * h * 4)
  // The top and bottom edges were measured before the rows moved; close enough after a small pull.
  stretchLine(mid, out, w, h, T, B, false)

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0)
  return c
}
