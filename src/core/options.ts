// Everything a scan can be told. Apps pass a target preset (what is photographed) and override what
// they need; every value here has a default that was measured on a phone in the POC.

export type Target = 'label' | 'barcode' | 'product' | 'document' | 'far'

export interface ScanOptions {
  /** Software preprocessing: contrast stretch, brightening of dark frames, sharpening. */
  preprocess: boolean
  /** Ask the camera for continuous focus and exposure, highest sharpness, raised contrast. */
  hardware: boolean
  /** Single scans: vote each line over `voteFrames` sharp frames. */
  voting: boolean
  voteFrames: number
  /** Laplacian variance below this: the frame is too blurred to read. */
  blurThreshold: number
  exposureComp: number
  /** Longest side of the image given to the text detector, in pixels. */
  detLimit: number
  /** Reads below this confidence are dropped. */
  minConfidence: number
  /** Single scans give up after this long. */
  timeoutSec: number
  /** Read only the aiming box in the middle of the picture, at full camera resolution. */
  aimBox: boolean
  /** Short side of the camera picture asked for: 1080, 1440 or 2160. */
  cameraHeight: number
  /** A chosen camera; empty: the back camera that focuses closest. */
  cameraId: string
  /** Move the lens from the page to find focus (only where the browser allows; slow on most phones). */
  focusSweep: boolean
  focusSettleFrames: number
  /** The near and far end of the scanning distance, in metres. */
  distance: [number, number]
  /** Continuous scanning: a line read with at least this confidence counts from one frame. */
  fastConfidence: number
  /** Continuous scanning: lines read with less are not counted (logos, marks). */
  minLineConfidence: number
  /** Run the models on the graphics processor where the browser offers WebGPU (prepared in the background). */
  gpu: boolean
  /** The picture's magnification (1-4): only the middle is shown and read. */
  viewZoom: number
  /**
   * Show the picture mirrored left to right, and read it as shown: for text seen through glass from
   * behind. The user turns it on when the text looks reversed.
   */
  mirror: boolean
  /** Read only once the phone has been steady for `steadyMs`. */
  waitSteady: boolean
  gyroThreshold: number
  diffThreshold: number
  steadyMs: number
}

export const defaults: ScanOptions = {
  preprocess: true,
  hardware: true,
  voting: true,
  voteFrames: 3,
  blurThreshold: 20,
  exposureComp: 0,
  detLimit: 640,
  minConfidence: 0.5,
  timeoutSec: 12,
  aimBox: true,
  cameraHeight: 2160,
  cameraId: '',
  focusSweep: false,
  focusSettleFrames: 1,
  distance: [0.08, 0.2],
  fastConfidence: 0.97,
  minLineConfidence: 0.75,
  gpu: true,
  viewZoom: 2,
  mirror: false,
  waitSteady: true,
  gyroThreshold: 25,
  diffThreshold: 12,
  steadyMs: 150,
}

/** What each target changes from the defaults. */
export const presets: Record<Target, Partial<ScanOptions>> = {
  label: { distance: [0.08, 0.2], cameraHeight: 2160, viewZoom: 2, aimBox: true },
  barcode: { distance: [0.08, 0.25], cameraHeight: 1080, viewZoom: 1, aimBox: true },
  product: { distance: [0.3, 1], cameraHeight: 2160, viewZoom: 1, aimBox: false },
  document: { distance: [0.2, 0.4], cameraHeight: 2160, viewZoom: 1, aimBox: false },
  far: { distance: [1, 5], cameraHeight: 2160, viewZoom: 2, aimBox: true },
}

/** The options for a target, with the app's own values on top. */
export function optionsFor(target: Target = 'label', own: Partial<ScanOptions> = {}): ScanOptions {
  return { ...defaults, ...presets[target], ...own }
}

/** Kept for the code that came from the POC, where these were the app's settings. */
export type Settings = ScanOptions
