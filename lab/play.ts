// The public demo (GitHub Pages): one tab per kind of scan, and the finish signal to choose.
// Everything runs on the phone; nothing is sent anywhere.
import '../src/index'
import {
  cropToPage,
  loadUnwarp,
  painted,
  stretchToEdges,
  unwarpPage,
  type BarcodeResult,
  type CamsenseScanner,
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
    progress: { steady: 'החזק יציב', capture: 'תמונה {done} מתוך {total}', merge: 'מאחד', flatten: 'מיישר', read: 'קורא' },
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
    progress: { steady: 'Hold still', capture: 'Picture {done} of {total}', merge: 'Merging', flatten: 'Flattening', read: 'Reading' },
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

function applyTab() {
  const c = TABS[tab]
  cam.setAttribute('target', c.target)
  cam.setAttribute('task', c.task)
  result.replaceChildren()
}

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

cam.addEventListener('camsense-ready', () => {
  ready = true
  status.textContent = t().ready
  render()
})
cam.addEventListener('camsense-error', (e) => {
  status.textContent = `${t().error}: ${(e as CustomEvent).detail.message}`
})

async function open() {
  status.textContent = t().opening
  await cam.start()
}

const line = (text: string) => Object.assign(document.createElement('li'), { textContent: text })

go.addEventListener('click', async () => {
  if (busy) return
  if (!ready) return open()
  busy = true
  go.disabled = true
  result.replaceChildren()
  status.textContent = t().scanning
  const t0 = performance.now()
  try {
    const c = TABS[tab]
    if (c.range) await scanPage(c.range)
    else if (c.task === 'barcode') {
      const r = (await cam.scan()) as BarcodeResult | null
      const ul = document.createElement('ul')
      r?.codes.forEach((code) => ul.append(line(`${code.value}  (${code.format})`)))
      result.append(ul)
      if (!r?.codes.length) status.textContent = t().nothing
    } else {
      const r = (await cam.scan()) as TextResult | null
      const ul = document.createElement('ul')
      r?.lines.forEach((l) => ul.append(line(l.text)))
      result.append(ul)
      if (!r?.lines.length) status.textContent = t().nothing
    }
    if (result.textContent || result.querySelector('img')) status.textContent = `${t().took}: ${Math.round(performance.now() - t0)} ${t().ms}`
  } finally {
    busy = false
    go.disabled = false
  }
})

/** A page: focus steps over the range, merged, then flattened, stretched to its edges and trimmed. */
async function scanPage([near, far]: [number, number]) {
  const stack = await cam.focusStack({ steps: 7, near, far })
  if (!stack) return
  cam.progress('flatten')
  status.textContent = t().model
  let page: HTMLCanvasElement
  try {
    await painted()
    await loadUnwarp(`${import.meta.env.BASE_URL}research/uvdoc.onnx`)
    const c = document.createElement('canvas')
    c.width = stack.stacked.width
    c.height = stack.stacked.height
    c.getContext('2d')!.putImageData(stack.stacked.pixels(), 0, 0)
    page = cropToPage(stretchToEdges(await unwarpPage(c)))
  } finally {
    cam.progress(null)
  }
  const url = page.toDataURL('image/jpeg', 0.9)
  const save = Object.assign(document.createElement('a'), { href: url, download: `${tab}-${Date.now()}.jpg`, textContent: t().save })
  result.append(Object.assign(document.createElement('img'), { src: url, alt: t()[tab] }), save)
}

applyTab()
render()
