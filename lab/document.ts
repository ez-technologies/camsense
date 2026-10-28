// Test screen: a whole page at a slant, phone held still. camsense takes frames focused near to far,
// lines them up and merges them; "send" keeps everything on the computer (POST /api/samples) for study
// (flattening and reading are done there).
import '../src/index'
import { cropToPage, loadUnwarp, stretchToEdges, unwarpPage, type CamsenseScanner, type FocusStackResult } from '../src/index'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cam = $<CamsenseScanner>('cam')
const go = $<HTMLButtonElement>('go')
const status = $('status')
const result = $('result')
cam.setAttribute('assets', `${import.meta.env.BASE_URL}camsense/`)
let ready = false
let torch = false

cam.addEventListener('camsense-ready', (e) => {
  ready = true
  go.textContent = 'צלם בפוקוס מדורג'
  status.textContent = `מוכן · ${JSON.stringify((e as CustomEvent).detail)}`
})
cam.addEventListener('camsense-error', (e) => (status.textContent = `שגיאה: ${(e as CustomEvent).detail.message}`))
$('torch').addEventListener('click', async () => {
  torch = !torch
  await cam.setTorch(torch)
})
const figure = (src: string, caption: string) => {
  const f = document.createElement('figure')
  f.append(Object.assign(document.createElement('img'), { src }), Object.assign(document.createElement('figcaption'), { textContent: caption }))
  return f
}
const title = (t: string) => Object.assign(document.createElement('h3'), { textContent: t })

go.addEventListener('click', async () => {
  if (!ready) return cam.start()
  status.textContent = 'מצלם… החזק יציב'
  result.innerHTML = ''
  const steps = Number($<HTMLSelectElement>('steps').value)
  const stack = (await cam.focusStack({ steps, near: 0.22, far: 0.6 })) as FocusStackResult | null
  if (!stack) return
  const frames = document.createElement('div')
  frames.className = 'frames'
  stack.frames.forEach((f, i) =>
    frames.append(
      figure(
        f.picture.toDataURL({ purpose: 'thumbnail' }),
        `${i + 1}: ${f.distance === null ? 'בלי שליטה' : `${Math.round(f.distance * 100)} ס״מ`} · ${
          stack.fits[i].used ? `${Math.round(stack.share[i] * 100)}%` : stack.fits[i].why === 'blurred' ? 'מטושטש, בחוץ' : `לא תואם (${stack.fits[i].match}), בחוץ`
        } · זז ${stack.shifts[i].dx},${stack.shifts[i].dy}`,
      ),
    ),
  )
  result.append(title(`${stack.frames.length} פריימים`), frames, title('מחובר'), figure(stack.stacked.toDataURL({ purpose: 'record' }), ''))
  let flat: HTMLCanvasElement | null = null
  let flattenMs = 0
  if ($<HTMLInputElement>('flatten').checked) {
    status.textContent = 'מיישר… (בפעם הראשונה יורד מודל של 32MB)'
    const toCanvas = () => {
      const c = document.createElement('canvas')
      c.width = stack.stacked.width
      c.height = stack.stacked.height
      c.getContext('2d')!.putImageData(stack.stacked.pixels(), 0, 0)
      return c
    }
    await loadUnwarp('/research/uvdoc.onnx')
    const t0 = performance.now()
    // Flattened, then trimmed to the page alone.
    flat = cropToPage(stretchToEdges(await unwarpPage(toCanvas())))
    flattenMs = Math.round(performance.now() - t0)
    // The flattened page is the result: shown first, above the merged picture and the frames.
    result.prepend(title(`הדף המיושר (${flattenMs} ms)`), figure(flat.toDataURL('image/jpeg', 0.9), ''))
  }
  status.textContent = `שליטה בפוקוס: ${stack.focusControl ? 'כן' : 'לא'} · צילום ומיזוג ${stack.ms} ms · יישור ${flattenMs} ms · ${stack.stacked.width}x${stack.stacked.height}`

  const send = Object.assign(document.createElement('button'), { className: 'big send', textContent: 'שלח למחשב' })
  send.addEventListener('click', async () => {
    send.disabled = true
    send.textContent = 'שולח…'
    const files: Record<string, string> = { stacked: stack.stacked.toDataURL({ format: 'jpeg', quality: 0.92 }) }
    if (flat) files.flat = flat.toDataURL('image/jpeg', 0.92)
    stack.frames.forEach((f, i) => (files[`frame-${i + 1}`] = f.picture.toDataURL({ format: 'jpeg', quality: 0.92 })))
    const meta = {
      kind: 'focus-stack',
      at: new Date().toISOString(),
      note: $<HTMLInputElement>('note').value,
      device: navigator.userAgent,
      steps,
      focusControl: stack.focusControl,
      frames: stack.frames.map((f, i) => ({ distance: f.distance, ms: f.ms, fit: stack.fits[i] })),
      flattenMs,
      share: stack.share,
      ms: stack.ms,
      size: [stack.stacked.width, stack.stacked.height],
    }
    const res = await fetch(`${import.meta.env.BASE_URL}api/samples`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ meta, files }) })
    send.textContent = res.ok ? '✓ נשלח. אפשר לצלם עוד' : `לא נשלח (${res.status})`
  })
  result.append(send)
})
