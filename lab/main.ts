import '../src/index'
import type { CamsenseScanner, Result } from '../src/index'

const cam = document.getElementById('cam') as CamsenseScanner
const out = document.getElementById('out')!
const go = document.getElementById('go') as HTMLButtonElement
const log = (s: string) => (out.textContent = `${s}\n${out.textContent}`.slice(0, 4000))
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

cam.include = { images: 'best', metadata: true }
let started = false
let torch = false

$('task').addEventListener('change', (e) => cam.setAttribute('task', (e.target as HTMLSelectElement).value))
$('target').addEventListener('change', (e) => cam.setAttribute('target', (e.target as HTMLSelectElement).value))
$('continuous').addEventListener('change', (e) => cam.toggleAttribute('continuous', (e.target as HTMLInputElement).checked))
$('zoom').addEventListener('click', () => (cam.magnification = cam.magnification >= 3 ? 1 : cam.magnification + 1))
$('torch').addEventListener('click', async () => log(`torch: ${(await cam.setTorch((torch = !torch))) ? (torch ? 'on' : 'off') : 'not available'}`))
const precision = $('precision')
precision.addEventListener('pointerdown', () => (cam.precisionHeld = true))
precision.addEventListener('pointerup', () => (cam.precisionHeld = false))
precision.addEventListener('pointercancel', () => (cam.precisionHeld = false))

cam.addEventListener('camsense-ready', (e) => {
  started = true
  go.textContent = 'סרוק'
  log(`ready ${JSON.stringify((e as CustomEvent).detail)}`)
})
cam.addEventListener('camsense-error', (e) => {
  log(`error ${(e as CustomEvent).detail.message}`)
  if (!started) go.textContent = 'הפעל מצלמה שוב'
})
cam.addEventListener('camsense-label', (e) => {
  const { label, started } = (e as CustomEvent).detail
  if (started) log(`label ${label.index + 1}: ${label.lines.map((l: { text: string }) => l.text).join(' | ')}`)
})
cam.addEventListener('camsense-code', (e) => log(`code ${(e as CustomEvent).detail.format}: ${(e as CustomEvent).detail.value}`))
cam.addEventListener('camsense-result', async (e) => {
  const r = (e as CustomEvent).detail as Result
  const summary =
    r.task === 'text' ? r.lines.map((l) => l.text).join(' | ') : r.task === 'barcode' ? r.codes.map((c) => `${c.format}:${c.value}`).join(' | ') : `sharpness ${r.sharpness}`
  let file = ''
  if (r.picture) {
    const f = await r.picture.toBlobs({ record: { purpose: 'record' }, thumb: { purpose: 'thumbnail' } })
    file = ` · record ${f.record.format} ${f.record.width}x${f.record.height} ${Math.round(f.record.blob.size / 1024)}KB · thumb ${Math.round(f.thumb.blob.size / 1024)}KB`
  }
  log(`result ${r.task}: ${summary || 'nothing'} · ${r.metadata?.ms ?? '?'} ms · ${r.metadata?.backend}${file}`)
  ;(window as unknown as { lastResult: Result }).lastResult = r
})

go.addEventListener('click', async () => {
  // Until the camera is open, the button opens it (again, after an error).
  if (!started) return cam.start()
  if (cam.continuous && go.textContent === 'סיים') return cam.stop()
  if (cam.continuous) go.textContent = 'סיים'
  await cam.scan()
  go.textContent = 'סרוק'
})
