// The public demo (GitHub Pages): one tab per kind of scan, and the finish signal to choose.
// Everything runs on the phone; nothing is sent anywhere.
import '../src/index'
import { createWorker, type Worker } from 'tesseract.js'
import {
  cropToPage,
  loadUnwarp,
  painted,
  stretchToEdges,
  unwarpPage,
  type BarcodeResult,
  type CamsenseScanner,
  type ModelSet,
  type ProgressText,
  type Target,
  type Task,
  type TextResult,
} from '../src/index'

type Tab = 'code' | 'barcode' | 'document' | 'receipt'
type Lang = 'he' | 'en'

const TEXT = {
  he: {
    code: 'קוד', barcode: 'ברקוד', document: 'מסמך', receipt: 'קבלה',
    hint: {
      code: 'קוד או מספר סידורי על תווית, 8-20 ס״מ. נגיעה בתמונה מכוונת לשורה.',
      barcode: 'ברקוד או QR, 8-25 ס״מ.',
      document: 'דף שלם, 25-50 ס״מ, גם באלכסון. מחזיקים יציב עד הצפצוף.',
      receipt: 'קבלה, 15-40 ס״מ, גם מקופלת. מחזיקים יציב עד הצפצוף.',
    },
    whenDone: 'בסיום:', beep: 'צפצוף', vibrate: 'רטט', flash: 'הבהוב', torch: 'פנס',
    open: 'הפעל מצלמה', scan: 'סרוק', opening: 'פותח מצלמה…', ready: 'מוכן', scanning: 'סורק…',
    nothing: 'לא נמצא כלום, נסה שוב', error: 'שגיאה', save: 'שמור תמונה', took: 'זמן', ms: 'מ״ש',
    labLink: 'מעבדה (כל ההגדרות)', model: 'בפעם הראשונה יורד מודל היישור (32MB)',
    progress: { steady: 'החזק יציב', capture: 'החזק יציב', merge: 'מאחד', flatten: 'מיישר', read: 'קורא טקסט' },
    mirror: 'כתב מראה', readLang: 'קריאה:', latin: 'אנגלית ומספרים', hebrew: 'עברית, אנגלית ומספרים',
    fromCross: 'מהצלב', px: 'פיקסלים', line: 'שורה', fromRight: 'מימין', fromLeft: 'משמאל', textTitle: 'הטקסט שנקרא',
    readModel: 'בפעם הראשונה יורד מודל הקריאה בעברית', clear: 'נקה',
  },
  en: {
    code: 'Code', barcode: 'Barcode', document: 'Document', receipt: 'Receipt',
    hint: {
      code: 'A code or serial number on a label, 8-20 cm. Touch the picture to aim at a line.',
      barcode: 'A barcode or QR code, 8-25 cm.',
      document: 'A whole page, 25-50 cm, at a slant too. Hold still until the beep.',
      receipt: 'A receipt, 15-40 cm, folded too. Hold still until the beep.',
    },
    whenDone: 'When done:', beep: 'Beep', vibrate: 'Vibrate', flash: 'Flash', torch: 'Torch',
    open: 'Open camera', scan: 'Scan', opening: 'Opening the camera…', ready: 'Ready', scanning: 'Scanning…',
    nothing: 'Nothing found, try again', error: 'Error', save: 'Save picture', took: 'Took', ms: 'ms',
    labLink: 'Lab (every setting)', model: 'The first time, the flattening model downloads (32 MB)',
    progress: { steady: 'Hold still', capture: 'Hold still', merge: 'Merging', flatten: 'Flattening', read: 'Reading the text' },
    mirror: 'Mirror', readLang: 'Read:', latin: 'English and digits', hebrew: 'Hebrew, English and digits',
    fromCross: 'from the cross', px: 'px', line: 'Line', fromRight: 'from the right', fromLeft: 'from the left', textTitle: 'Text read',
    readModel: 'The first time, the Hebrew reading model downloads', clear: 'Clear',
  },
} satisfies Record<Lang, unknown>

/** The element's settings per tab; pages are taken in focus steps over their range of distance (metres). */
const TABS: Record<Tab, { target: Target; task: Task; range?: [number, number] }> = {
  code: { target: 'label', task: 'text' },
  barcode: { target: 'barcode', task: 'barcode' },
  document: { target: 'document', task: 'photo', range: [0.22, 0.6] },
  receipt: { target: 'document', task: 'photo', range: [0.15, 0.45] },
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cam = $<CamsenseScanner>('cam')
const go = $<HTMLButtonElement>('go')
const status = $('status')
const result = $('result')
cam.setAttribute('assets', `${import.meta.env.BASE_URL}camsense/`)

let lang: Lang = (localStorage.getItem('camsense.lang') as Lang) || 'he'
let tab: Tab = (localStorage.getItem('camsense.tab') as Tab) || 'code'
let ready = false
let busy = false
let torch = false
const t = () => TEXT[lang]

function render() {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
  $('lang').textContent = lang === 'he' ? 'English' : 'עברית'
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    b.textContent = t()[b.dataset.tab as Tab]
    b.setAttribute('aria-selected', String(b.dataset.tab === tab))
  })
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t()[el.dataset.t as 'beep'] as string
  })
  $('whenDone').textContent = t().whenDone
  $('hint').textContent = t().hint[tab]
  go.textContent = ready ? t().scan : t().open
  cam.progressText = t().progress as ProgressText
}

// ---- the finish signal: kept on this phone ----
const FEEDBACK = ['beep', 'vibrate', 'flash'] as const
const saved = localStorage.getItem('camsense.feedback')
const chosen = new Set(saved === null ? ['beep', 'vibrate'] : saved.split(' ').filter(Boolean))
function applyFeedback() {
  const value = FEEDBACK.filter((f) => chosen.has(f)).join(' ')
  cam.setAttribute('feedback', value || 'none')
  localStorage.setItem('camsense.feedback', value)
}
for (const f of FEEDBACK) {
  const box = $<HTMLInputElement>(`fb-${f}`)
  box.checked = chosen.has(f)
  box.addEventListener('change', () => {
    if (box.checked) chosen.add(f)
    else chosen.delete(f)
    applyFeedback()
    // Let the user feel the choice at once.
    if (box.checked && ready) cam.signal()
  })
}
applyFeedback()

// ---- reading: Latin labels (the default) or the Hebrew set, which reads English and digits too ----
const R = `${import.meta.env.BASE_URL}research/`
const HEBREW: ModelSet = {
  name: 'hebrew-mobile',
  det: `${R}word-det/det.onnx`,
  rec: `${R}mobile-word/rec.onnx`,
  dict: `${R}charset_v2f.txt`,
  cls: 'cls.onnx',
  rtl: true,
  db: { thresh: 0.3, boxThresh: 0.35, unclip: 1.3 },
}
const LATIN = cam.models
let tess: Promise<Worker> | null = null
let readHebrew = localStorage.getItem('camsense.readHebrew') === '1'
const readLang = $<HTMLSelectElement>('readLang')
readLang.value = readHebrew ? 'he' : 'latin'

function applyTab() {
  const c = TABS[tab]
  cam.setAttribute('target', c.target)
  cam.setAttribute('task', c.task)
  cam.models = readHebrew ? HEBREW : LATIN
  $('readRow').hidden = tab !== 'code'
}

readLang.addEventListener('change', async () => {
  readHebrew = readLang.value === 'he'
  localStorage.setItem('camsense.readHebrew', readHebrew ? '1' : '0')
  applyTab()
  if (ready && !busy) {
    ready = false
    render()
    await open()
  }
})

$('lang').addEventListener('click', () => {
  lang = lang === 'he' ? 'en' : 'he'
  localStorage.setItem('camsense.lang', lang)
  render()
})

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (busy || b.dataset.tab === tab) return
    cam.stop()
    tab = b.dataset.tab as Tab
    localStorage.setItem('camsense.tab', tab)
    applyTab()
    render()
    status.textContent = ''
    // The camera is opened again for the new kind of scan (other camera, size and models).
    if (ready) {
      ready = false
      render()
      await open()
    }
  }),
)

$('torch').addEventListener('click', async () => {
  torch = !torch
  if (!(await cam.setTorch(torch))) torch = false
})

const mirror = $<HTMLButtonElement>('mirror')
mirror.addEventListener('click', () => {
  cam.mirrored = !cam.mirrored
  mirror.setAttribute('aria-pressed', String(cam.mirrored))
})

$('clear').addEventListener('click', () => result.replaceChildren())

cam.addEventListener('camsense-ready', () => {
  ready = true
  status.textContent = t().ready
  render()
  // Pages: the flattening model and the reader are fetched and prepared while the user aims, not after the scan.
  if (TABS[tab].range) {
    loadUnwarp(`${R}uvdoc.onnx`).catch(() => {})
    tess ??= createWorker(['heb', 'eng'])
  }
})
cam.addEventListener('camsense-error', (e) => {
  status.textContent = `${t().error}: ${(e as CustomEvent).detail.message}`
})

async function open() {
  status.textContent = t().opening
  await cam.start()
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}
/** Text in its own direction (a Hebrew line inside an English page, and the reverse). */
const bidi = (text: string) => el('bdi', { textContent: text })
const HEBREW_LETTER = /[֐-׿]/

go.addEventListener('click', async () => {
  if (busy) return
  if (!ready) return open()
  busy = true
  go.disabled = true
  status.textContent = t().scanning
  const t0 = performance.now()
  // Each scan is added on top; earlier ones stay below until "clear".
  const entry = el('section', { className: 'entry' })
  try {
    const c = TABS[tab]
    if (c.range) await scanPage(c.range, entry)
    else if (c.task === 'barcode') {
      const r = (await cam.scan()) as BarcodeResult | null
      if (r?.codes.length) entry.append(el('ul', {}, ...r.codes.map((code) => el('li', {}, bidi(code.value), el('small', { textContent: ` ${code.format}` })))))
    } else {
      const r = (await cam.scan()) as TextResult | null
      // Nearest to the cross (or the middle) first.
      const lines = [...(r?.lines ?? [])].sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))
      if (lines.length) {
        entry.append(
          el('ol', {}, ...lines.map((l) => el('li', {}, bidi(l.text), el('small', { textContent: l.dist === null ? '' : ` · ${Math.round(l.dist)} ${t().px} ${t().fromCross}` })))),
        )
      }
    }
    const took = `${t().took}: ${Math.round(performance.now() - t0)} ${t().ms}`
    if (entry.childElementCount) {
      entry.prepend(el('h3', { textContent: `${t()[tab]} · ${new Date().toLocaleTimeString(lang)} · ${took}` }))
      result.prepend(entry)
      status.textContent = took
    } else status.textContent = t().nothing
  } finally {
    busy = false
    go.disabled = false
  }
})

/** A page: focus steps over the range, merged, flattened, stretched to its edges, trimmed, then read. */
async function scanPage([near, far]: [number, number], entry: HTMLElement) {
  const stack = await cam.focusStack({ steps: 7, near, far })
  if (!stack) return
  cam.progress('flatten')
  status.textContent = t().model
  let page: HTMLCanvasElement
  try {
    await painted()
    await loadUnwarp(`${R}uvdoc.onnx`)
    const c = document.createElement('canvas')
    c.width = stack.stacked.width
    c.height = stack.stacked.height
    c.getContext('2d')!.putImageData(stack.stacked.pixels(), 0, 0)
    page = cropToPage(stretchToEdges(await unwarpPage(c)))
    // The page is shown at once; the text follows.
    const url = page.toDataURL('image/jpeg', 0.9)
    entry.append(el('img', { src: url, alt: t()[tab] }), el('a', { href: url, download: `${tab}-${Date.now()}.jpg`, textContent: t().save }))
    result.prepend(entry)
    cam.progress('read')
    status.textContent = t().readModel
    // Tesseract (Hebrew and English) was the best reader of flat pages in the comparison; it runs in its own worker.
    tess ??= createWorker(['heb', 'eng'])
    const { data } = await (await tess).recognize(page, {}, { blocks: true })
    const lines = (data.blocks ?? [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .map((l) => ({ text: l.text.trim(), box: l.bbox }))
      .filter((l) => l.text)
      .sort((a, b) => a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1))
    const w = page.width
    entry.append(
      el('h4', { textContent: t().textTitle }),
      el(
        'ol',
        { className: 'text' },
        ...lines.map((l) => {
          // Where the line starts: from the right for Hebrew, from the left otherwise.
          const rtl = HEBREW_LETTER.test(l.text)
          const from = Math.round((100 * (rtl ? w - l.box.x1 : l.box.x0)) / w)
          return el('li', {}, bidi(l.text), el('small', { textContent: ` · ${from}% ${rtl ? t().fromRight : t().fromLeft}` }))
        }),
      ),
    )
  } finally {
    cam.progress(null)
  }
}

applyTab()
render()
