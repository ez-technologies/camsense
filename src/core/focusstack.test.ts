import { describe, expect, it } from 'vitest'
import { blendWeights, estimateShift, tileSharpness } from './focusstack'

describe('tileSharpness', () => {
  it('a tile with edges is sharper than a flat one', () => {
    const w = 8
    const h = 4
    const g = new Float32Array(w * h)
    // Left 4x4 tile: a checker pattern; right tile: flat grey.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 4 ? ((x + y) % 2) * 255 : 128
    const { values, tx } = tileSharpness(g, w, h, 4)
    expect(tx).toBe(2)
    expect(values[0]).toBeGreaterThan(values[1])
  })
})

describe('blendWeights', () => {
  it('gives each tile mostly to its sharpest frame, and the weights add up to 1', () => {
    const near = new Float32Array([100, 10])
    const far = new Float32Array([10, 100])
    const [wn, wf] = blendWeights([near, far], 2, 1)
    expect(wn[0]).toBeGreaterThan(0.99)
    expect(wf[1]).toBeGreaterThan(0.99)
    expect(wn[0] + wf[0]).toBeCloseTo(1)
  })

  it('an all-flat tile is shared equally', () => {
    const [a, b] = blendWeights([new Float32Array([0]), new Float32Array([0])], 1, 1)
    expect(a[0]).toBeCloseTo(0.5)
    expect(b[0]).toBeCloseTo(0.5)
  })
})

describe('estimateShift', () => {
  // A picture with edges (random blocks), and the same picture moved.
  const w = 256
  const h = 192
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const blocks = Array.from({ length: 60 }, () => [rnd() * w, rnd() * h, 6 + rnd() * 20, rnd() * 255])
  const draw = (sx: number, sy: number) => {
    const g = new Float32Array(w * h).fill(128)
    for (const [bx, by, size, v] of blocks) {
      for (let y = Math.max(0, Math.floor(by + sy)); y < Math.min(h, by + sy + size); y++)
        for (let x = Math.max(0, Math.floor(bx + sx)); x < Math.min(w, bx + sx + size); x++) g[y * w + x] = v
    }
    return g
  }

  it('finds how far a frame moved', () => {
    const r = estimateShift(draw(0, 0), draw(13, -7), w, h, 32)
    expect([r.dx, r.dy]).toEqual([13, -7])
  })

  it('a frame that did not move has no shift', () => {
    const r = estimateShift(draw(0, 0), draw(0, 0), w, h, 32)
    expect([r.dx, r.dy]).toEqual([0, 0])
  })
})
