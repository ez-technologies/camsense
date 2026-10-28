import { describe, expect, it } from 'vitest'
import { blendWeights, tileSharpness } from './focusstack'

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
