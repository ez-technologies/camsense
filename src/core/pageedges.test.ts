import { describe, expect, it } from 'vitest'
import { backgroundMask, smoothEdge } from './pageedges'

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

describe('smoothEdge', () => {
  it('fills missing values from the nearest known ones and ignores a single spike', () => {
    const v = [10, 10, -1, 10, 90, 10, 10, 10, -1, -1]
    const s = smoothEdge(v, 0, 2)
    for (const x of s) expect(x).toBeCloseTo(10, 0)
  })
  it('uses the fallback when nothing is known', () => {
    expect(smoothEdge([-1, -1, -1], 7, 1)).toEqual([7, 7, 7])
  })
})
