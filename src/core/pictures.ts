// Pictures a scan hands back. They stay as they are in memory until the app asks for a file, so they
// never delay a result; a file is made in the format, size and compression the app asks for.

export type ImageFormat = 'jpeg' | 'webp' | 'png'

/** Ready choices, so an app does not need the numbers. */
export type Purpose = 'thumbnail' | 'record' | 'sample' | 'training'

export interface FileOptions {
  purpose?: Purpose
  format?: ImageFormat
  /** Longest side in pixels; the picture is shrunk before it is made into a file. */
  maxSide?: number
  /** JPEG and WebP compression, 0-1. */
  quality?: number
}

export const purposes: Record<Purpose, Required<Omit<FileOptions, 'purpose'>>> = {
  thumbnail: { format: 'jpeg', maxSide: 320, quality: 0.75 },
  record: { format: 'webp', maxSide: 1280, quality: 0.8 },
  sample: { format: 'webp', maxSide: 1600, quality: 0.85 },
  training: { format: 'png', maxSide: Infinity, quality: 1 },
}

/** A purpose's values, with the app's own on top; JPEG at 0.9 and full size when nothing is said. */
export function resolveFileOptions(o: FileOptions = {}): Required<Omit<FileOptions, 'purpose'>> {
  const base = o.purpose ? purposes[o.purpose] : { format: 'jpeg' as const, maxSide: Infinity, quality: 0.9 }
  return { format: o.format ?? base.format, maxSide: o.maxSide ?? base.maxSide, quality: o.quality ?? base.quality }
}

/** The size a picture is shrunk to so that its longest side is at most `maxSide` (never enlarged). */
export function fitSize(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface PictureFile {
  blob: Blob
  /** The format actually made: a browser that cannot make WebP gets JPEG instead. */
  format: ImageFormat
  width: number
  height: number
  fellBack: boolean
}

export class Picture {
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  get width() {
    return this.canvas.width
  }

  get height() {
    return this.canvas.height
  }

  /** The raw pixels, with no conversion at all. */
  pixels(): ImageData {
    return this.canvas.getContext('2d')!.getImageData(0, 0, this.width, this.height)
  }

  bitmap(): Promise<ImageBitmap> {
    return createImageBitmap(this.canvas)
  }

  private scaled(maxSide: number): HTMLCanvasElement {
    const { width, height } = fitSize(this.width, this.height, maxSide)
    if (width === this.width && height === this.height) return this.canvas
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.canvas, 0, 0, width, height)
    return c
  }

  /** A file of the picture, made now. */
  async toBlob(o: FileOptions = {}): Promise<PictureFile> {
    const r = resolveFileOptions(o)
    const c = this.scaled(r.maxSide)
    const make = (format: ImageFormat) =>
      new Promise<Blob>((ok, fail) =>
        c.toBlob((b) => (b ? ok(b) : fail(new Error('could not make the picture'))), `image/${format}`, r.quality),
      )
    let blob = await make(r.format)
    let format = r.format
    // A browser that cannot make the format quietly makes PNG: give JPEG instead (smaller), and say so.
    const fellBack = blob.type !== `image/${r.format}`
    if (fellBack) {
      format = 'jpeg'
      blob = await make('jpeg')
    }
    return { blob, format, width: c.width, height: c.height, fellBack }
  }

  /** Several files of the same picture, made one after the other (for example documentation and training). */
  async toBlobs<K extends string>(files: Record<K, FileOptions>): Promise<Record<K, PictureFile>> {
    const out = {} as Record<K, PictureFile>
    for (const k of Object.keys(files) as K[]) out[k] = await this.toBlob(files[k])
    return out
  }

  /** A data URL, to show the picture at once. */
  toDataURL(o: FileOptions = {}): string {
    const r = resolveFileOptions(o)
    return this.scaled(r.maxSide).toDataURL(`image/${r.format}`, r.quality)
  }
}
