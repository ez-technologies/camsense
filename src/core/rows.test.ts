import { describe, expect, it } from 'vitest'
import { joinRows } from './rows'

const w = (text: string, x: number, y: number, d?: number) => ({ text, x, y, h: 20, confidence: 0.9, d })

describe('joinRows', () => {
  it('joins the words of a row in reading order, right to left for Hebrew', () => {
    const rows = joinRows([w('9.90', 100, 200, 78), w('מים', 300, 203, 178), w('מינרליים', 200, 198, 100)], true)
    expect(rows).toEqual([{ text: 'מים מינרליים 9.90', confidence: 0.9, d: 78 }])
  })
  it('keeps a row with no Hebrew in it left to right', () => {
    expect(joinRows([w('A7310592', 120, 100), w('SN', 50, 100)], true)[0].text).toBe('SN A7310592')
  })
  it('keeps rows apart, and words of one row far apart (another column)', () => {
    const rows = joinRows([w('SN', 50, 100), w('A7310592', 120, 102), w('Order', 50, 160), w('far', 900, 101)], false)
    expect(rows.map((r) => r.text)).toEqual(['SN A7310592', 'far', 'Order'])
  })
})
