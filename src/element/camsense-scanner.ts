// <camsense-scanner>: opens the camera and shows the picture, with the aiming box, the cross and the
// boxes of what is being read. It has no buttons: the app sets everything from code (attributes and
// properties) and draws its own controls. Results come back as DOM events.
import {
  cachedProbe,
  canScan,
  capabilities,
  closestFocusing,
  FocusSearch,
  canSweepFocus,
  openCamera,
  probeCameras,
  saveProbe,
  setFocus,
  setHardware,
  setTorch,
  trackResolution,
  type CameraCaps,
  type FocusSweep,
} from '../core/camera'
import { runContinuous, words, type Capture } from '../core/continuous'
import { beep, parseFeedback, progressLine, PROGRESS_TEXT, type Phase, type ProgressText } from '../core/feedback'
import { barcodeReader, readBarcodes, type BarcodeRead } from '../core/barcode'
import { startMotion, SteadyGate } from '../core/motion'
import { hasWebGpu, loadEngine, setAssetsBase, type Engine } from '../core/ocr/engine'
import { optionsFor, type ScanOptions, type Target } from '../core/options'
import { bestShot } from '../core/photo'
import { stackFocus, type FrameFit } from '../core/focusstack'
import { Picture } from '../core/pictures'
import {
  AIM_H,
  AIM_W,
  displayScale,
  focusPoint,
  frameRegion,
  grab,
  runScan,
  type FrameLog,
  type Precision,
  type ScanProgress,
} from '../core/scanner'

export type Task = 'text' | 'barcode' | 'photo'
export type ImagesWanted = 'none' | 'best' | 'best+crops'

/** One line of text read, with its words (each searchable on its own). */
export interface Line {
  text: string
  words: string[]
  confidence: number
  /** Pixels from the focus point (the middle, or a touched point); null when not known. */
  dist: number | null
}

/** What the scan was done with and how it went: for samples, study or training. */
export interface Metadata {
  startedAt: string
  ms: number
  device: string
  camera: { label: string; opened: string; resolution: string; minFocus: number | null; torch: boolean }
  backend: 'webgpu' | 'wasm' | 'none'
  target: Target
  options: ScanOptions
  frameLog?: FrameLog[]
  focusSearches?: (FocusSweep & { at: number })[]
}

export interface TextResult {
  task: 'text'
  lines: Line[]
  /** Continuous scans: one entry per label. */
  labels?: Label[]
  picture?: Picture
  metadata?: Metadata
}

export interface Label {
  index: number
  lines: Line[]
  atMs: number
  picture?: Picture
}

export interface BarcodeResult {
  task: 'barcode'
  codes: BarcodeRead[]
  picture?: Picture
  metadata?: Metadata
}

export interface PhotoResult {
  task: 'photo'
  picture: Picture
  sharpness: number
  metadata?: Metadata
}

export type Result = TextResult | BarcodeResult | PhotoResult

/** A focus stack: frames focused near to far, and the merged picture. */
export interface FocusStackResult {
  /** False when the browser does not let the page move the lens: the frames are then all alike. */
  focusControl: boolean
  frames: { picture: Picture; distance: number | null; sharpness: number; ms: number }[]
  stacked: Picture
  /** Share of the picture each frame gave most of. */
  share: number[]
  /** How far each frame had moved (the hand), in pixels, before it was lined up. */
  shifts: { dx: number; dy: number }[]
  /** Per frame: used or left out (blurred, mismatch), its size change and move, and its edge match. */
  fits: FrameFit[]
  ms: number
}

const STYLE = `
:host { display: block; position: relative; overflow: hidden; background: #000; border-radius: var(--camsense-radius, 12px);
  aspect-ratio: var(--camsense-aspect, 3 / 4); touch-action: none; user-select: none; -webkit-user-select: none; }
:host([data-aimbox]) { aspect-ratio: var(--camsense-aspect, 1.3 / 1); }
video { width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: center; }
.aim { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none;
  border: 2px solid var(--camsense-box-color, rgba(255,255,255,0.9)); border-radius: 8px;
  box-shadow: 0 0 0 100vmax var(--camsense-shade, rgba(0,0,0,0.35)); }
.aim.moving { border-color: var(--camsense-moving-color, rgba(160,160,160,0.6)); border-style: dashed; }
.cross { position: absolute; width: 34px; height: 34px; transform: translate(-50%, -50%); pointer-events: none; }
.cross::before, .cross::after { content: ''; position: absolute; background: var(--camsense-cross-color, #ffd600); box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }
.cross.only::before, .cross.only::after { background: var(--camsense-precision-color, #ff1744); }
.cross::before { left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); }
.cross::after { top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-50%); }
.boxes { position: absolute; inset: 0; pointer-events: none; }
.box { position: absolute; border: 2px solid var(--camsense-read-color, #00e676); border-radius: 4px; }
[hidden] { display: none; }
.flash { position: absolute; inset: 0; pointer-events: none; background: var(--camsense-flash-color, #fff); opacity: 0; }
.flash.on { animation: camsense-flash 0.35s ease-out; }
@keyframes camsense-flash { from { opacity: 0.8; } to { opacity: 0; } }
.progress { position: absolute; left: 12px; right: 12px; bottom: 12px; pointer-events: none; padding: 10px 12px 12px;
  border-radius: 10px; background: var(--camsense-progress-bg, rgba(0,0,0,0.65)); color: var(--camsense-progress-color, #fff);
  font: 600 16px system-ui, sans-serif; text-align: center; }
.progress .bar { position: relative; height: 6px; margin-top: 8px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.25); }
.progress .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--camsense-progress-fill, #42a5f5); transition: width 0.2s; }
:host(:dir(rtl)) .progress .fill { inset: 0 0 0 auto; }
/* Without a known share the bar runs on its own; the animation runs off the page's main thread, so it
   keeps moving while the merge and the flattening hold the page. */
.progress .run { position: absolute; top: 0; bottom: 0; width: 35%; background: var(--camsense-progress-fill, #42a5f5);
  will-change: transform; animation: camsense-run 1.1s linear infinite; }
@keyframes camsense-run { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
`

/** Settings the element reads from attributes. */
const ATTRS = ['target', 'task', 'continuous', 'assets', 'formats', 'magnification', 'gpu', 'images', 'touch', 'mirror', 'feedback', 'progress'] as const

export class CamsenseScanner extends HTMLElement {
  static observedAttributes = [...ATTRS]

  /** Options on top of the target preset, set from code. */
  options: Partial<ScanOptions> = {}
  /** Pictures and metadata to return with each result. */
  include: { images: ImagesWanted; metadata: boolean } = { images: 'none', metadata: false }
  /** Words of the progress shown over the picture (English by default; set them for another language). */
  progressText: ProgressText = { ...PROGRESS_TEXT }

  private video!: HTMLVideoElement
  private aimEl!: HTMLDivElement
  private crossEl!: HTMLDivElement
  private boxesEl!: HTMLDivElement
  private flashEl!: HTMLDivElement
  private progressEl!: HTMLDivElement
  private track: MediaStreamTrack | null = null
  private caps: CameraCaps = {}
  private engine: Engine | null = null
  private audio: AudioContext | null = null
  private stopFlag = { stopped: false }
  private running = false
  private precision: Precision = { point: null, only: false }
  private chosen: { fx: number; fy: number } | null = null
  private focusSearch: FocusSearch | null = null
  /** Which camera request worked (see the ladder in openCamera). */
  private cameraNote = ''

  connectedCallback() {
    if (this.shadowRoot) return
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${STYLE}</style><video playsinline muted></video><div class="aim" part="aim"></div>
      <div class="cross" part="cross" hidden></div><div class="boxes" part="boxes"></div><div class="flash" part="flash"></div>
      <div class="progress" part="progress" role="status" aria-live="polite" hidden><span></span><div class="bar"><div class="fill"></div><div class="run"></div></div></div>`
    this.video = root.querySelector('video')!
    this.aimEl = root.querySelector('.aim')!
    this.crossEl = root.querySelector('.cross')!
    this.boxesEl = root.querySelector('.boxes')!
    this.flashEl = root.querySelector('.flash')!
    this.progressEl = root.querySelector('.progress')!
    this.flashEl.addEventListener('animationend', () => this.flashEl.classList.remove('on'))
    // A touch on the picture moves the cross there until the scan ends (unless touch="none").
    this.addEventListener('pointerdown', (e) => {
      if (this.getAttribute('touch') === 'none') return
      this.setPointerCapture(e.pointerId)
      this.aimAt(this.pointIn(e))
    })
    this.addEventListener('pointermove', (e) => {
      if (e.buttons && this.getAttribute('touch') !== 'none') this.aimAt(this.pointIn(e))
    })
    this.applyLayout()
  }

  disconnectedCallback() {
    this.stop()
    this.track?.stop()
    this.track = null
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.applyLayout()
  }

  // ---- settings ----

  get target(): Target {
    return (this.getAttribute('target') as Target) || 'label'
  }
  get task(): Task {
    return (this.getAttribute('task') as Task) || 'text'
  }
  get continuous(): boolean {
    return this.hasAttribute('continuous')
  }
  /** The options in force: the target's preset, the app's options, then attributes. */
  get settings(): ScanOptions {
    const s = optionsFor(this.target, this.options)
    const mag = this.getAttribute('magnification')
    if (mag) s.viewZoom = Number(mag)
    if (this.getAttribute('gpu') === 'off') s.gpu = false
    // mirror (present): the picture is shown and read mirrored, for text seen through glass from behind.
    if (this.hasAttribute('mirror')) s.mirror = true
    return s
  }

  /** The picture's magnification (1-4). */
  set magnification(v: number) {
    this.setAttribute('magnification', String(v))
  }
  get magnification() {
    return this.settings.viewZoom
  }

  /** Show and read the picture mirrored (the app's button for text seen through glass). */
  set mirrored(on: boolean) {
    this.toggleAttribute('mirror', on)
  }
  get mirrored() {
    return this.settings.mirror
  }

  /** Torch on or off (Android only). Resolves to whether it worked. */
  async setTorch(on: boolean): Promise<boolean> {
    return this.track ? setTorch(this.track, on) : false
  }
  get torchAvailable() {
    return !!this.caps.torch
  }

  /** Precision while the app's button is held: the cross in the middle, only the line under it is read. */
  set precisionHeld(held: boolean) {
    this.setPoint(held ? { fx: 0.5, fy: 0.5 } : this.chosen, held)
  }

  /** Move the cross to a point (shares of the element's width and height), or back to the middle (null). */
  aimAt(p: { fx: number; fy: number } | null) {
    this.chosen = p
    this.setPoint(p, false)
  }

  // ---- lifecycle ----

  /**
   * Opens the camera and prepares what the task needs. Call it from a tap (sound and the iPhone's
   * motion permission need one). Fires `camsense-ready` or `camsense-error`.
   */
  async start(): Promise<void> {
    const assets = this.getAttribute('assets')
    if (assets) setAssetsBase(assets)
    this.audio ??= new AudioContext()
    this.audio.resume()
    await startMotion()
    const device = await canScan()
    if (!device.touch || !device.camera) {
      return this.fail(new Error(`camsense needs a touch screen and a camera (touch: ${device.touch}, camera: ${device.camera})`))
    }
    try {
      await this.openCamera()
      if (this.task === 'text') await this.prepareEngine()
      if (this.task === 'barcode') await barcodeReader(this.formats())
      this.emit('camsense-ready', {
        camera: this.track?.label ?? '',
        opened: this.cameraNote,
        resolution: this.track ? trackResolution(this.track) : '',
        torch: !!this.caps.torch,
        backend: this.engine?.backend ?? 'none',
      })
    } catch (e) {
      this.fail(e)
    }
  }

  /** Runs the task. Single: resolves with the result. Continuous: runs until `stop()`, firing events meanwhile. */
  async scan(): Promise<Result | null> {
    if (!this.track || this.running) return null
    this.running = true
    this.stopFlag = { stopped: false }
    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    try {
      const s = this.settings
      let result: Result
      if (this.task === 'photo') {
        const shot = await bestShot(this.video, s)
        this.signal()
        result = { task: 'photo', picture: shot.picture, sharpness: shot.sharpness }
      } else if (this.task === 'barcode') {
        result = await this.scanBarcodes(s)
      } else {
        result = await this.scanText(s)
      }
      if (this.include.metadata) result.metadata = this.metadata(startedAt, t0, result)
      if (this.include.images === 'none' && result.task !== 'photo') delete result.picture
      this.emit('camsense-result', result)
      return result
    } catch (e) {
      this.fail(e)
      return null
    } finally {
      this.running = false
      this.boxesEl.replaceChildren()
      this.aimEl.classList.remove('moving')
      this.aimAt(null)
      if (this.track && canSweepFocus(this.caps)) setFocus(this.track, null)
    }
  }

  /**
   * Focus stack, for a page at a slant: the phone held still, `steps` frames are taken with the lens
   * moved from near to far (in even steps of dioptres), and merged so every part comes from its
   * sharpest frame. Where the page cannot move the lens, the frames are taken as they come.
   */
  async focusStack(o: { steps?: number; near?: number; far?: number; settleFrames?: number; maxSide?: number } = {}): Promise<FocusStackResult | null> {
    if (!this.track || this.running) return null
    this.running = true
    const t0 = performance.now()
    try {
      const s = this.settings
      const steps = o.steps ?? 5
      const control = canSweepFocus(this.caps)
      const min = this.caps.focusDistance?.min ?? 0.1
      const max = this.caps.focusDistance?.max ?? 1
      const near = Math.max(min, o.near ?? s.distance[0] * 0.7)
      const far = Math.min(max, o.far ?? s.distance[1] * 1.8)
      const video = this.video
      const nextFrame = () =>
        new Promise<void>((r) => ('requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 33)))
      // Start once the phone is still (at most 2 seconds of waiting).
      this.progress('steady')
      await startMotion()
      const gate = new SteadyGate(s)
      for (const t = performance.now(); performance.now() - t < 2000; ) {
        if (gate.check(grab(video, frameRegion(video, s), 320), performance.now()).steady) break
        await nextFrame()
      }
      const frames: FocusStackResult['frames'] = []
      const canvases: HTMLCanvasElement[] = []
      for (let i = 0; i < steps; i++) {
        this.progress('capture', i + 1, steps)
        const t1 = performance.now()
        let distance: number | null = null
        if (control) {
          // Even in dioptres (1/distance): the near range, where focus changes fastest, gets more steps.
          const d = 1 / (1 / near - (i / Math.max(1, steps - 1)) * (1 / near - 1 / far))
          if (await setFocus(this.track, d)) distance = Math.round(d * 1000) / 1000
          // The lens takes a few frames to arrive: a frame taken while it moves is blurred everywhere.
          for (let k = 0; k < (o.settleFrames ?? 3); k++) await nextFrame()
        } else {
          await nextFrame()
        }
        const frame = grab(video, frameRegion(video, s), Infinity)
        canvases.push(frame)
        frames.push({ picture: new Picture(frame), distance, sharpness: 0, ms: Math.round(performance.now() - t1) })
      }
      // The phone may move now; the merge holds the page, so the progress is painted first.
      this.signal()
      this.progress('merge')
      await painted()
      const merged = stackFocus(canvases, { maxSide: o.maxSide ?? 1600 })
      merged.share.forEach((_, i) => (frames[i].sharpness = merged.share[i]))
      return {
        focusControl: control,
        frames,
        stacked: new Picture(merged.canvas),
        share: merged.share,
        shifts: merged.shifts,
        fits: merged.fits,
        ms: Math.round(performance.now() - t0),
      }
    } finally {
      this.running = false
      this.progress(null)
      if (this.track && canSweepFocus(this.caps)) setFocus(this.track, null)
    }
  }

  /**
   * Shows what the scan is doing over the picture (unless progress="none") and fires `camsense-progress`
   * ({ phase, done, total }; phase null when it ends). Apps call it for their own steps after a scan,
   * such as flattening a page; then wait for `painted()` before heavy work so it is seen.
   */
  progress(phase: Phase | null, done?: number, total?: number) {
    this.emit('camsense-progress', { phase, done: done ?? null, total: total ?? null })
    const el = this.progressEl
    if (!el) return
    el.hidden = !phase || this.getAttribute('progress') === 'none'
    if (!phase) return
    el.querySelector('span')!.textContent = progressLine(this.progressText, phase, done, total)
    const known = done !== undefined && !!total
    const fill = el.querySelector<HTMLDivElement>('.fill')!
    fill.style.width = known ? `${(100 * done!) / total!}%` : '0'
    el.querySelector<HTMLDivElement>('.run')!.hidden = known
  }

  /** The finish signal the app chose (feedback attribute): beep, vibration and/or a flash. */
  signal() {
    const f = parseFeedback(this.getAttribute('feedback'))
    if (f.vibrate) navigator.vibrate?.(60)
    if (f.beep && this.audio) beep(this.audio)
    if (f.flash && this.flashEl) {
      this.flashEl.classList.remove('on')
      void this.flashEl.offsetWidth
      this.flashEl.classList.add('on')
    }
  }

  /** Ends a continuous scan (its result follows), or gives up a single one. */
  stop() {
    this.stopFlag.stopped = true
  }

  // ---- tasks ----

  private async scanText(s: ScanOptions): Promise<TextResult> {
    const engine = this.engine!
    const focuser = this.focuser()
    if (this.continuous) {
      const labels: Label[] = []
      const toLabel = (c: Capture, index: number): Label => ({
        index,
        lines: c.lines.map((text, i) => ({ text, words: words(text), confidence: c.conf[i] ?? c.confidence, dist: c.dist[i] ?? null })),
        atMs: c.atMs,
        picture: this.include.images === 'best+crops' ? new Picture(c.crop) : undefined,
      })
      const run = await runContinuous(
        this.video,
        engine,
        s,
        (c, started) => {
          if (started) {
            this.signal()
            labels.push(toLabel(c, labels.length))
          } else {
            labels[labels.length - 1] = toLabel(c, labels.length - 1)
          }
          this.emit('camsense-label', { label: labels[labels.length - 1], started })
        },
        (p) => this.drawBoxes(p),
        this.stopFlag,
        focuser,
        undefined,
        (steady) => this.showSteady(steady),
        this.precision,
      )
      this.lastLog = { frameLog: run.frameLog, focusSearches: run.sweeps }
      return {
        task: 'text',
        lines: labels.flatMap((l) => l.lines),
        labels,
        picture: run.last ? new Picture(run.last) : undefined,
      }
    }
    const r = await runScan(this.video, engine, s, (p) => this.drawBoxes(p), this.stopFlag, focuser, undefined, (st) => this.showSteady(st), this.precision)
    this.lastLog = { frameLog: r.frameLog, focusSearches: r.sweeps }
    if (r.reads.length) this.signal()
    return {
      task: 'text',
      lines: r.reads.map((v) => ({ text: v.text, words: words(v.text), confidence: Math.round(v.confidence * 1000) / 1000, dist: v.d ?? null })),
      picture: new Picture(r.original),
    }
  }

  /** Codes: single scans stop at the first frame with any; continuous ones beep once per new value. */
  private async scanBarcodes(s: ScanOptions): Promise<BarcodeResult> {
    const gate = new SteadyGate(s)
    const seen = new Map<string, BarcodeRead>()
    const t0 = performance.now()
    let last: HTMLCanvasElement | null = null
    while (!this.stopFlag.stopped && (this.continuous || performance.now() - t0 < s.timeoutSec * 1000)) {
      const region = frameRegion(this.video, s)
      const frame = grab(this.video, region)
      const motion = gate.check(frame, performance.now())
      this.showSteady(motion.steady)
      if (motion.steady) {
        const at = focusPoint(this.video, s, region, frame, this.precision)
        let codes = await readBarcodes(frame, at.focus, this.formats())
        if (at.only) codes = codes.slice(0, 1)
        for (const c of codes) {
          if (seen.has(c.value)) continue
          seen.set(c.value, c)
          last = frame
          this.signal()
          if (this.continuous) this.emit('camsense-code', c)
        }
        if (!this.continuous && codes.length) break
      }
      await new Promise((r) => setTimeout(r, 30))
    }
    return { task: 'barcode', codes: [...seen.values()], picture: last ? new Picture(last) : undefined }
  }

  // ---- inside ----

  private lastLog: { frameLog?: FrameLog[]; focusSearches?: (FocusSweep & { at: number })[] } = {}

  private metadata(startedAt: string, t0: number, r: Result): Metadata {
    const s = this.settings
    return {
      startedAt,
      ms: Math.round(performance.now() - t0),
      device: navigator.userAgent,
      camera: {
        label: this.track?.label ?? '',
        opened: this.cameraNote,
        resolution: this.track ? trackResolution(this.track) : '',
        minFocus: this.caps.focusDistance?.min ?? null,
        torch: !!(this.track?.getSettings() as { torch?: boolean } | undefined)?.torch,
      },
      backend: this.engine?.backend ?? 'none',
      target: this.target,
      options: s,
      ...(r.task === 'text' ? this.lastLog : {}),
    }
  }

  private formats(): string[] | undefined {
    const f = this.getAttribute('formats')
    return f ? f.split(',').map((x) => x.trim()).filter(Boolean) : undefined
  }

  private async openCamera() {
    const s = this.settings
    let probe = cachedProbe()
    if (!probe) {
      probe = await probeCameras()
      saveProbe(probe)
    }
    // Close work (labels, barcodes) uses the camera that focuses closest; further away, the default.
    const id = s.cameraId || (s.distance[0] < 0.25 ? closestFocusing(probe) : '')
    // Some browsers (in-app ones especially) refuse a chosen camera or a large picture: ask for less,
    // step by step, and say which request worked.
    const ladder: [string, number, string][] = [
      [id, s.cameraHeight, id ? 'chosen camera' : 'default camera'],
      ...(id ? ([['', s.cameraHeight, 'default camera']] as [string, number, string][]) : []),
      ...(s.cameraHeight > 1080 ? ([['', 1080, 'default camera, 1080p']] as [string, number, string][]) : []),
      ['', 0, 'default camera, any size'],
    ]
    let lastError: unknown = null
    // start() again (another target, say) replaces the camera: the old one is let go first.
    this.track?.stop()
    this.track = null
    for (const [cam, height, note] of ladder) {
      try {
        this.track = await openCamera(this.video, cam, height)
        this.cameraNote = note
        break
      } catch (e) {
        lastError = e
        if (cam) saveProbe(null)
      }
    }
    if (!this.track) throw lastError
    this.caps = capabilities(this.track)
    await setHardware(this.track, s.hardware, s.exposureComp)
    this.focusSearch = null
  }

  /** The main processor first (quick to load); the graphics processor in the background where it exists. */
  private async prepareEngine() {
    this.engine = await loadEngine(false)
    if (!this.settings.gpu) return
    if (!(await hasWebGpu())) return
    loadEngine(true).then(
      (gpu) => {
        if (gpu.backend === 'webgpu') this.engine = gpu
      },
      () => {},
    )
  }

  private focuser() {
    const s = this.settings
    if (!s.focusSweep || !this.track || !canSweepFocus(this.caps)) return null
    const video = this.video
    const waitFrame = () =>
      new Promise<void>((r) =>
        'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(() => r()) : setTimeout(r, 33),
      )
    this.focusSearch ??= new FocusSearch(this.track, waitFrame, s.focusSettleFrames, s.distance)
    const search = this.focusSearch
    return (measure: () => number, force?: boolean) => search.find(measure, force)
  }

  private applyLayout() {
    const s = this.settings
    this.toggleAttribute('data-aimbox', s.aimBox)
    this.aimEl.hidden = !s.aimBox
    this.aimEl.style.width = `${AIM_W * 100}%`
    this.aimEl.style.height = `${AIM_H * 100}%`
    if (this.video) this.video.style.transform = `scale(${s.viewZoom})${s.mirror ? ' scaleX(-1)' : ''}`
  }

  private setPoint(p: { fx: number; fy: number } | null, only: boolean) {
    this.precision.point = p
    this.precision.only = only
    this.crossEl.hidden = !p
    this.crossEl.classList.toggle('only', only)
    if (p) {
      this.crossEl.style.left = `${p.fx * 100}%`
      this.crossEl.style.top = `${p.fy * 100}%`
    }
  }

  private pointIn(e: PointerEvent) {
    const r = this.getBoundingClientRect()
    return {
      fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  private showSteady(steady: boolean) {
    if (this.aimEl.classList.contains('moving') === !steady) return
    this.aimEl.classList.toggle('moving', !steady)
    this.emit('camsense-steady', { steady })
  }

  /** The boxes of the last frame read, over the picture. */
  private drawBoxes(p: ScanProgress) {
    const v = this.video
    if (!v.videoWidth) return
    const s = displayScale(v.videoWidth, v.videoHeight, v.clientWidth, v.clientHeight, this.settings.viewZoom)
    const ox = (v.clientWidth - v.videoWidth * s) / 2
    const oy = (v.clientHeight - v.videoHeight * s) / 2
    this.boxesEl.replaceChildren(
      ...p.lastReads.map((r) => {
        const d = document.createElement('div')
        d.className = 'box'
        d.style.left = `${ox + (p.region.x + r.box.cx / p.scale) * s}px`
        d.style.top = `${oy + (p.region.y + r.box.cy / p.scale) * s}px`
        d.style.width = `${(r.box.length / p.scale) * s}px`
        d.style.height = `${(r.box.thickness / p.scale) * s}px`
        d.style.transform = `translate(-50%, -50%) rotate(${r.box.angle}rad)`
        return d
      }),
    )
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  private fail(e: unknown) {
    this.emit('camsense-error', { message: String(e instanceof Error ? e.message : e) })
  }
}

/** Resolves once the screen has been painted (two animation frames): call before work that holds the page. */
export function painted(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

if (!customElements.get('camsense-scanner')) customElements.define('camsense-scanner', CamsenseScanner)

declare global {
  interface HTMLElementTagNameMap {
    'camsense-scanner': CamsenseScanner
  }
}
