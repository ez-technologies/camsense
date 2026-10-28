import { describe, expect, it } from 'vitest'
import { backgroundMask, fitEdge } from './pageedges'

describe('backgroundMask', () => {
  // A 60x40 picture: dark background, paper from x=10, with a thin printed line and a printed band.
  const w = 60
  const h = 40
  const g = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 10 ? 20 : 230
  for (let x = 10; x < w; x++) for (const y of [5, 6]) g[y * w + x] = 10 // a printed band reaching the edge
  for (let y = 15; y < 30; y++) g[y * w + 30] = 0 // a pen stroke inside the page
  const bg = backgroundMask(g, w, h, 120, 3)

  it('marks the thick dark area at the side as background', () => {
    expect(bg[20 * w + 2]).toBe(1)
    expect(bg[20 * w + 8]).toBe(1)
  })
  it('keeps print inside the page, even a band that reaches the border', () => {
    expect(bg[20 * w + 30]).toBe(0)
    expect(bg[5 * w + 40]).toBe(0)
    expect(bg[5 * w + 59]).toBe(0)
    expect(bg[20 * w + 12]).toBe(0)
  })
})

describe('fitEdge', () => {
  it('follows a bent edge and ignores points that stray from it', () => {
    const v = Array.from({ length: 100 }, (_, i) => 20 + 30 * ((i - 50) / 50) ** 2)
    v[10] = 90 // print taken for background
    v[60] = -1 // nothing found
    const f = fitEdge(v, 0, 2)
    expect(f[10]).toBeCloseTo(20 + 30 * 0.64, 0)
    expect(f[50]).toBeCloseTo(20, 0)
    expect(f[60]).toBeCloseTo(21.2, 0)
  })
  it('leaves the side alone when the points do not agree on a curve', () => {
    const v = Array.from({ length: 100 }, (_, i) => (i % 2 ? 5 : 60) + (i % 7) * 9)
    expect(fitEdge(v, 0, 2).every((x) => x === 0)).toBe(true)
  })
  it('leaves the side alone when nothing was found', () => {
    expect(fitEdge([-1, -1, -1, -1], 7, 2)).toEqual([7, 7, 7, 7])
  })
})
