import { describe, expect, it } from 'vitest'
import { fitSize, resolveFileOptions } from './pictures'

describe('resolveFileOptions', () => {
  it('a purpose gives its format, size and compression', () => {
    expect(resolveFileOptions({ purpose: 'record' })).toEqual({ format: 'webp', maxSide: 1280, quality: 0.8 })
    expect(resolveFileOptions({ purpose: 'training' }).format).toBe('png')
  })
  it('the app\'s own values win over the purpose', () => {
    expect(resolveFileOptions({ purpose: 'record', maxSide: 800 }).maxSide).toBe(800)
  })
  it('nothing said: JPEG at 0.9, full size', () => {
    expect(resolveFileOptions()).toEqual({ format: 'jpeg', maxSide: Infinity, quality: 0.9 })
  })
})

describe('fitSize', () => {
  it('shrinks the longest side to the limit and keeps the shape', () => {
    expect(fitSize(2160, 3840, 1280)).toEqual({ width: 720, height: 1280 })
  })
  it('never enlarges', () => {
    expect(fitSize(300, 200, 1280)).toEqual({ width: 300, height: 200 })
  })
})
