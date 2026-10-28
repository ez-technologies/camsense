# camsense: design proposal

A library that any web app (MICMS first) imports to use the phone camera for one task at a time: read the
text on a label, read a barcode, take the sharpest photo of a product, and more later. It grows out of
[number-scanner-poc](https://github.com/israeleis/number-scanner-poc): the parts that are not about weapons or MICMS (camera choice, steadiness, sharpness, focus,
magnification, text reading) become the library, and the POC becomes its lab app.

**Status: proposal, nothing built.** Each section ends with what the owner decides.

## 1. Two layers of settings

Every use of the camera is described by **what is being photographed** (a target preset: distance and
size) and **how the user works** (interaction options). The app picks a preset and overrides what it
needs.

```ts
const result = await camera.run({
  target: 'label',            // what: label | barcode | product | document | far
  task: 'text',               // what back: text | barcode | photo
  interaction: { aim: 'touch-moves-cross', precision: 'hold-button', continuous: true },
  match: (lines) => findItem(lines),   // optional: the app says when a result is right
})
```

## 2. Target presets ("what is being photographed")

A browser cannot measure distance. The distance range of a preset is used to:
- **choose the camera** that can focus within it (on the S25 the main camera focuses from 10 cm;
  the macro lens is not reachable from a web page),
- **limit the focus search** where the site can move the lens (otherwise the phone's autofocus is used),
- **set the starting magnification** and the aiming box,
- **warn "too close"** when the range starts nearer than the camera can focus.

| Preset | Distance | Typical use | Starting setup |
|---|---|---|---|
| `label` | 8–20 cm | Serial labels, printed or stamped text | Closest-focusing back camera, 4K, ×2, box 1.4 : 1, text reading, steadiness wait |
| `barcode` | 8–25 cm | Barcodes and QR codes | Main camera, 1080p (enough for barcodes), ×1, wide box 3 : 1, native barcode reader |
| `product` | 30–100 cm | Photo of an item for its record | Main camera, highest resolution, ×1, no box (whole picture), best-shot |
| `document` | 20–40 cm | A form or a page | Main camera, 4K, ×1, page-shaped box, best-shot (text reading optional) |
| `far` | 1–5 m | A sign, a container number | Main or zoom camera, 4K, ×2–×4, text reading |

Each value of a preset can be overridden (`{ target: 'label', distance: [5, 15], magnification: 1.5 }`).

**Owner decides:** the list of presets and their distances.

## 3. Tasks ("what comes back")

- **`text`**: all text in the box as **lines** (each with its words, confidence, box, distance from the
  aim point), **centre-out** or from the aim point. Single (stops at the first steady result or on time)
  or continuous (labels written down one after another, with beep and vibration).
- **`barcode`**: the browser's own barcode reader (`BarcodeDetector`) where it exists (Chrome on Android;
  fast, exact, no download). Without it, a small barcode library or reading the printed digits as text.
  Returns the value and its format.
- **`photo`** (best shot): waits for a steady phone and focus, takes several frames in well under a
  second, and returns the sharpest as an image (JPEG or WebP, chosen size), with its sharpness.
  No models are downloaded for this task.
- Later: `document` (straighten the page), `count` (how many items)…

### What comes back besides the result

Every task can return, beside the data it read, the **pictures** and the **metadata** of the scan, so an
app can keep samples, study failures or train a model later. The app chooses per call:

```ts
camera.run({
  task: 'text',
  include: {
    images: 'none' | 'best' | 'best+crops' | 'every-read-frame',  // default 'none'
    metadata: true,      // see below
  },
  onSample: (sample) => upload(sample),  // optional: called after each result, for production samples
})
```

- **Pictures:** none (text only, the default), the frame the result came from, plus a crop of each line or
  label, or every frame that was read.
- **Metadata:** time and duration; device and browser; camera (which one, resolution, closest focus,
  torch); settings used (preset, magnification, aiming box, thresholds, GPU or not); the aim point and
  each line's box and distance from it; per frame: sharpness, motion, timings of each step, what was read
  and with what confidence; focus searches. This is what the POC's lab saved and what made every fix
  possible.
- **File format and size, chosen by the app** when it asks for the file:

  ```ts
  const file = await sample.images.best.toBlob({ purpose: 'record' })              // a ready preset
  const file = await sample.images.best.toBlob({ format: 'webp', maxSide: 1024, quality: 0.8 })
  // Several at once, from the same frame (each made only when asked):
  const { record, training } = await sample.images.best.toBlobs({ record: { purpose: 'record' }, training: { purpose: 'training' } })
  ```

  The request can also name them up front, so they are ready together:
  `include: { images: 'best', files: { record: { purpose: 'record' }, training: { purpose: 'training' } } }`.
  They are still made after the result is returned, one after the other, off the scan's path.

  | Format | Size | Where it works | For |
  |---|---|---|---|
  | `jpeg` | small | every browser | the default; quality 0–1 |
  | `webp` | 25–35% smaller than JPEG at the same quality | Chrome, Android, Firefox; Safari may not make it | smaller uploads; falls back to JPEG, and says so |
  | `png` | 5–10 times JPEG | every browser | lossless: training, or fine detail such as engraving |
  | `pixels` | in memory only (ImageData / ImageBitmap) | every browser | the app processes the picture itself; no conversion at all |

  `maxSide` (longest side in pixels) shrinks the picture before it is made into a file; `quality` sets
  the compression of JPEG and WebP; the result is a `Blob` (to save or upload) or a data URL (to show).

  **Purpose presets**, so an app does not have to know the numbers:

  | Purpose | Makes | About |
  |---|---|---|
  | `thumbnail` | JPEG, longest side 320, quality 0.75 | 15–30 KB, for lists |
  | `record` | WebP (else JPEG), longest side 1280, quality 0.8 | 100–200 KB, to keep with an item as documentation |
  | `sample` | WebP (else JPEG), longest side 1600, quality 0.85 | production samples for study |
  | `training` | PNG, full size | lossless, for training a model |
- **Pictures never delay the result.** The frames are already in memory; the result comes back at once
  with references to them. Turning a picture into a file (JPEG/WebP, roughly 20–80 ms per picture on a
  phone) happens only when the app asks (`image.toBlob()`), after the user has had the beep. The library
  keeps nothing once it has returned; pictures the app does not hold are freed by the browser.
  `every-read-frame` keeps a few MB per frame until the scan ends, so in continuous scanning it keeps only
  the frames a result came from.
- Nothing is sent anywhere by the library itself: it hands the sample to the app, and the app decides
  where it goes (MICMS: its production sample store, switched on per unit).

**Owner decides:** which tasks are in the first version (proposal: `text`, `photo`, `barcode`).

## 4. Interaction options ("how the user works")

| Option | Values | Default |
|---|---|---|
| `aim` | `centre` (results centre-out) · `touch-moves-cross` (a touch moves the cross until the scan ends) · `fixed-cross` (cross always in the middle) | `touch-moves-cross` |
| `precision` | `none` · `hold-button` (only the line under the cross while held) · `touch-and-hold` | `hold-button` |
| `continuous` | single scan or continuous | per task |
| `aimBox` | on/off, shape (`1.4:1`, `3:1`, `page`, custom) | per target |
| `magnification` | buttons shown, starting value | per target |
| `torch` | `button` · `auto-when-dark` · `off` | `button` |
| `waitSteady` | on/off, thresholds | on |
| `feedback` | beep, vibration, flash of the box | beep + vibration |
| `stopWhen` | `first-steady` · `match` (the app's `match` callback says yes) · `timeout` · `manual` | `match` if given, else `first-steady` |
| `gpu` | `auto` (prepare in the background where WebGPU exists) · `off` | `auto` |
| UI | full component (viewfinder, buttons) or headless (the app draws its own UI with hooks) | full component |

**Owner decides:** the defaults, and whether the component's buttons are fixed or arranged by the app.

## 5. Package layout

```
camsense/
  packages/core/     TypeScript, no framework: camera, steadiness, sharpness, focus, OCR engine,
                     text, barcode, best-shot, continuous labels, telemetry
  packages/react/    <CameraAssist> viewfinder component and hooks (useCameraTask)
  apps/lab/          this POC: try every option on a phone, lab server, analysis script
  models/            PaddleOCR models + copy script (the app serves them; not inside the package)
```

- **Downloads only when needed:** nothing on a device without touch or camera; models only for `text`;
  the WebGPU runtime only where WebGPU exists, in the background.
- **Install in MICMS** as a GitHub dependency pinned to a version tag; MICMS updates when it decides.
- **Tests:** the POC's 72 unit tests move with the code; the lab app is the place to measure on phones
  before a release.

**Owner decides:** the repo's name, and public or private.

## 6. What stays in MICMS

Matching against the unit's serials (whole lines first, then neighbouring words across small gaps, then
words; O/0, I/1, B/8… tolerant), the scan modes (search, count, move, sweep, place check), item pages, and
the production sample store. MICMS gives the library a `match` callback and a telemetry sink.
