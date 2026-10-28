import { describe, expect, it } from 'vitest'
import { parseFeedback, progressLine, PROGRESS_TEXT } from './feedback'

describe('parseFeedback', () => {
  it('defaults to beep and vibration', () => {
    expect(parseFeedback(null)).toEqual({ beep: true, vibrate: true, flash: false })
    expect(parseFeedback('  ')).toEqual({ beep: true, vibrate: true, flash: false })
  })
  it('takes any combination, in any order, with spaces or commas', () => {
    expect(parseFeedback('flash')).toEqual({ beep: false, vibrate: false, flash: true })
    expect(parseFeedback('Vibrate, flash')).toEqual({ beep: false, vibrate: true, flash: true })
  })
  it('none turns all of them off', () => {
    expect(parseFeedback('none')).toEqual({ beep: false, vibrate: false, flash: false })
  })
})

describe('progressLine', () => {
  it('fills in the numbers', () => {
    expect(progressLine(PROGRESS_TEXT, 'capture', 3, 7)).toBe('Hold still')
    expect(progressLine({ ...PROGRESS_TEXT, capture: 'תמונה {done} מתוך {total}' }, 'capture', 1, 5)).toBe('תמונה 1 מתוך 5')
  })
})
