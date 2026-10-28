// Barcodes and 2-D codes (QR, Data Matrix, …): the browser's own reader where it has one (Chrome on
// Android: fast, exact, nothing to download); elsewhere (iPhone) ZXing in WebAssembly, downloaded only then.
import { assetsBase } from './ocr/engine'
import { distanceToBox } from './ocr/engine'

export interface BarcodeRead {
  value: string
  /** As the Barcode Detection API names it: qr_code, data_matrix, ean_13, code_128, … */
  format: string
  box: { x: number; y: number; w: number; h: number }
  /** Pixels from the focus point (the middle, or a touched point) to the code; 0 when on it. */
  dist: number
}

interface Detected {
  rawValue: string
  format: string
  boundingBox: DOMRectReadOnly
}
interface Detector {
  detect(source: CanvasImageSource): Promise<Detected[]>
}
interface DetectorClass {
  new (o?: { formats?: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

let cached: { key: string; detector: Promise<{ detector: Detector; native: boolean }> } | null = null

/** A reader for the given formats (all when none are given), the browser's own when it can read them. */
export function barcodeReader(formats?: string[]) {
  const key = (formats ?? []).join(',')
  if (cached?.key === key) return cached.detector
  const detector = (async () => {
    const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector
    if (Native) {
      const supported = await Native.getSupportedFormats()
      const wanted = formats ? formats.filter((f) => supported.includes(f)) : supported
      if (wanted.length && (!formats || wanted.length === formats.length)) {
        return { detector: new Native({ formats: wanted }), native: true }
      }
    }
    const zxing = await import('barcode-detector/ponyfill')
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `${assetsBase()}zxing_reader.wasm` : prefix + path),
      },
    })
    const Zx = zxing.BarcodeDetector as unknown as DetectorClass
    return { detector: new Zx(formats ? { formats } : undefined), native: false }
  })()
  cached = { key, detector }
  return detector
}

/** The codes in a frame, nearest the focus point first. */
export async function readBarcodes(
  frame: HTMLCanvasElement,
  focus: { x: number; y: number },
  formats?: string[],
): Promise<BarcodeRead[]> {
  const { detector } = await barcodeReader(formats)
  const found = await detector.detect(frame)
  return orderByFocus(
    found.map((d) => ({
      value: d.rawValue,
      format: d.format,
      box: { x: d.boundingBox.x, y: d.boundingBox.y, w: d.boundingBox.width, h: d.boundingBox.height },
      dist: 0,
    })),
    focus,
  )
}

/** Sets each code's distance from the focus point and sorts nearest first. */
export function orderByFocus(reads: BarcodeRead[], focus: { x: number; y: number }): BarcodeRead[] {
  return reads
    .map((r) => ({
      ...r,
      dist: Math.round(
        distanceToBox(focus, { cx: r.box.x + r.box.w / 2, cy: r.box.y + r.box.h / 2, length: r.box.w, thickness: r.box.h, angle: 0 }),
      ),
    }))
    .sort((a, b) => a.dist - b.dist)
}
