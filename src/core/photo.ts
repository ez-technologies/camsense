// Best shot: wait for a steady phone, take a few frames, keep the sharpest. No models are needed.
import { startMotion, SteadyGate } from './motion'
import type { ScanOptions } from './options'
import { Picture } from './pictures'
import { frameRegion, grab, sharpnessOf } from './scanner'

export interface BestShotOptions {
  /** How many frames to compare once the phone is steady. */
  frames?: number
  /** Give up waiting for a steady phone after this long and take the frames anyway. */
  steadyTimeoutMs?: number
  /** Longest side of the kept picture in pixels (Infinity: the camera's full resolution). */
  maxSide?: number
}

export interface BestShot {
  picture: Picture
  /** Sharpness of the kept frame (variance of the Laplacian on a 640-pixel copy), and of each tried. */
  sharpness: number
  tried: number[]
  /** Time waiting for a steady phone, and in all. */
  steadyWaitMs: number
  ms: number
  steady: boolean
}

/** The index of the sharpest of several measures (the first on a tie). */
export function sharpest(values: number[]): number {
  return values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
}

const nextFrame = (video: HTMLVideoElement) =>
  new Promise<void>((r) =>
    'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 33),
  )

export async function bestShot(video: HTMLVideoElement, s: ScanOptions, o: BestShotOptions = {}): Promise<BestShot> {
  const frames = o.frames ?? 6
  const t0 = performance.now()
  await startMotion()
  const gate = new SteadyGate(s)
  let steady = !s.waitSteady
  while (!steady && performance.now() - t0 < (o.steadyTimeoutMs ?? 2000)) {
    steady = gate.check(grab(video, frameRegion(video, s), 320), performance.now()).steady
    if (!steady) await nextFrame(video)
  }
  const steadyWaitMs = Math.round(performance.now() - t0)
  let best: HTMLCanvasElement | null = null
  let bestSharp = -1
  const tried: number[] = []
  for (let i = 0; i < frames; i++) {
    const frame = grab(video, frameRegion(video, s), o.maxSide ?? Infinity)
    const sharp = Math.round(sharpnessOf(frame, 640))
    tried.push(sharp)
    if (sharp > bestSharp) {
      best = frame
      bestSharp = sharp
    }
    if (i < frames - 1) await nextFrame(video)
  }
  return {
    picture: new Picture(best!),
    sharpness: bestSharp,
    tried,
    steadyWaitMs,
    ms: Math.round(performance.now() - t0),
    steady,
  }
}
