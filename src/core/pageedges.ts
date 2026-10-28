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

/** Most colour a pixel may have and still count as paper (max-min over max of its channels). */
const PAPER_COLOUR = 0.16

/** Paper-likeness of each pixel: its brightness, or 0 when it is coloured (a rug, skin, a table). */
export function paperness(data: Uint8ClampedArray, n: number): { g: Uint8Array; level: number } {
  const gray = new Uint8Array(n)
  const g = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const gr = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = (r * 77 + gr * 150 + b * 29) >> 8
    const hi = Math.max(r, gr, b)
    const colour = hi ? (hi - Math.min(r, gr, b)) / hi : 0
    g[i] = colour > PAPER_COLOUR ? 0 : gray[i]
  }
  return { g, level: paperLevel(gray) }
}

/** Least-squares quadratic through (i, v[i]) for the indices in `use`; returns the coefficients a + b*t + c*t^2, t = i/n. */
function fitQuadratic(v: number[], use: number[]): [number, number, number] | null {
  if (use.length < 3) return null
  const n = v.length
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const r = [0, 0, 0]
  for (const i of use) {
    const t = i / n
    const p = [1, t, t * t]
    for (let a = 0; a < 3; a++) {
      r[a] += p[a] * v[i]
      for (let b = 0; b < 3; b++) m[a][b] += p[a] * p[b]
    }
  }
  // Gaussian elimination on the 3x3 normal equations.
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let k = c + 1; k < 3; k++) if (Math.abs(m[k][c]) > Math.abs(m[piv][c])) piv = k
    if (Math.abs(m[piv][c]) < 1e-9) return null
    ;[m[c], m[piv]] = [m[piv], m[c]]
    ;[r[c], r[piv]] = [r[piv], r[c]]
    for (let k = 0; k < 3; k++) {
      if (k === c) continue
      const f = m[k][c] / m[c][c]
      for (let b = c; b < 3; b++) m[k][b] -= f * m[c][b]
      r[k] -= f * r[c]
    }
  }
  return [r[0] / m[0][0], r[1] / m[1][1], r[2] / m[2][2]]
}

/**
 * A page's edge is a smooth curve. Fit one (a quadratic, refitted without the points far from it) to
 * the measured edge; when too few points agree, the side is left where it is (`fallback`).
 * `tolerance` is how far, in pixels, a measured point may be from the curve and still agree.
 */
export function fitEdge(v: number[], fallback: number, tolerance: number): number[] {
  const n = v.length
  let use = v.map((x, i) => (x >= 0 ? i : -1)).filter((i) => i >= 0)
  let k: [number, number, number] | null = null
  for (let round = 0; round < 4; round++) {
    k = fitQuadratic(v, use)
    if (!k) break
    const kk = k
    const at = (i: number) => kk[0] + kk[1] * (i / n) + kk[2] * (i / n) ** 2
    const next = use.filter((i) => Math.abs(v[i] - at(i)) <= tolerance * (round < 3 ? 3 - round : 1))
    if (next.length === use.length && round > 0) break
    use = next
  }
  if (!k || use.length < n * 0.5) return v.map(() => fallback)
  const kk = k
  return v.map((_, i) => kk[0] + kk[1] * (i / n) + kk[2] * (i / n) ** 2)
}

/** Value of an edge line (measured on the small copy) at a full-size position. */
function edgeAt(e: number[], pos: number, scale: number): number {
  const p = Math.min(e.length - 1, Math.max(0, pos * scale))
  const i = Math.floor(p)
  const j = Math.min(e.length - 1, i + 1)
  return (e[i] * (1 - (p - i)) + e[j] * (p - i)) / scale
}

/** Side of the small copy the page's edges are found on; the stretch itself is done at full size. */
const DETECT_SIDE = 400

/**
 * Stretch the page so its edges meet the picture's edges. `maxPull` limits how far, as a share of the
 * side, an edge may be pulled in before it is taken as background, not a bent edge.
 */
export function stretchToEdges(src: HTMLCanvasElement, maxPull = 0.18): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const scale = Math.min(1, DETECT_SIDE / Math.max(w, h))
  const sw = Math.max(8, Math.round(w * scale))
  const sh = Math.max(8, Math.round(h * scale))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sx = small.getContext('2d', { willReadFrequently: true })!
  sx.drawImage(src, 0, 0, sw, sh)
  const { g, level } = paperness(sx.getImageData(0, 0, sw, sh).data, sw * sh)
  const bg = backgroundMask(g, sw, sh, level, Math.max(2, Math.round(Math.max(sw, sh) * 0.012)))
  const capX = Math.round(sw * maxPull)
  const capY = Math.round(sh * maxPull)
  // An edge is the first paper pixel from the side; a side that is background further than the cap is
  // not a bent edge (the picture missed the page there) and is filled from its neighbours.
  const scan = (n: number, cap: number, at: (k: number) => number, fromEnd: boolean) => {
    for (let k = 0; k <= cap; k++) if (!bg[at(fromEnd ? n - 1 - k : k)]) return fromEnd ? n - 1 - k : k
    return -1
  }
  const left: number[] = []
  const right: number[] = []
  for (let y = 0; y < sh; y++) {
    left.push(scan(sw, capX, (x) => y * sw + x, false))
    right.push(scan(sw, capX, (x) => y * sw + x, true))
  }
  const top: number[] = []
  const bottom: number[] = []
  for (let x = 0; x < sw; x++) {
    top.push(scan(sh, capY, (y) => y * sw + x, false))
    bottom.push(scan(sh, capY, (y) => y * sw + x, true))
  }
  // Edge pixels are inclusive; the stretch maps the paper from its first to its last pixel.
  const tol = Math.max(2, Math.max(sw, sh) * 0.01)
  const clamp = (e: number[], lo: number, hi: number) => e.map((v) => Math.min(hi, Math.max(lo, v)))
  const Ls = clamp(fitEdge(left, 0, tol), 0, capX)
  const Rs = clamp(fitEdge(right, sw - 1, tol), sw - 1 - capX, sw - 1).map((v) => v + 1)
  const Ts = clamp(fitEdge(top, 0, tol), 0, capY)
  const Bs = clamp(fitEdge(bottom, sh - 1, tol), sh - 1 - capY, sh - 1).map((v) => v + 1)
  const full = (e: number[], n: number, end: boolean) =>
    Array.from({ length: n }, (_, i) => edgeAt(e, i, scale) - (end ? 1 : 0))
  const L = full(Ls, h, false)
  const R = full(Rs, h, true)
  const T = full(Ts, w, false)
  const B = full(Bs, w, true)

  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data
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
