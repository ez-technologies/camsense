import { describe, expect, it } from 'vitest'
import { sharpest } from './photo'

describe('sharpest', () => {
  it('picks the sharpest frame', () => {
    expect(sharpest([12, 340, 280, 90])).toBe(1)
  })
  it('keeps the first of equal frames', () => {
    expect(sharpest([50, 50])).toBe(0)
  })
})
