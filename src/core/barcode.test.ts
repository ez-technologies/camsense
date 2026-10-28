import { describe, expect, it } from 'vitest'
import { orderByFocus } from './barcode'

describe('orderByFocus', () => {
  it('puts the code under the focus point first and measures the others', () => {
    const at = (value: string, x: number) => ({ value, format: 'qr_code', box: { x, y: 100, w: 50, h: 50 }, dist: 0 })
    const out = orderByFocus([at('far', 400), at('here', 90)], { x: 110, y: 120 })
    expect(out.map((r) => r.value)).toEqual(['here', 'far'])
    expect(out[0].dist).toBe(0)
    expect(out[1].dist).toBe(290)
  })
})
