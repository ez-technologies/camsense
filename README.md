# camsense

Camera recognition for the browser: point a phone at something and get back what matters, quickly.
Read the text on a label (lines and words, from the middle out), read a barcode or QR code, or take
the sharpest photo in under a second. Everything runs on the phone. On a device without a touch screen
and a camera nothing is downloaded.

It grows out of [number-scanner-poc](https://github.com/israeleis/number-scanner-poc), where reading
serial labels was tested on a real phone; its findings are in
[docs/INTEGRATION.md](https://github.com/israeleis/number-scanner-poc/blob/main/docs/INTEGRATION.md).
The design and its decisions: [docs/DESIGN.md](docs/DESIGN.md).

## Use

```
npm install github:ez-technologies/camsense#v0.1.0
npx camsense-copy-assets public/camsense     # models and runtime files, served by your app
```

```html
<camsense-scanner id="cam" target="label" task="text" assets="/camsense/"></camsense-scanner>
<button id="go">Scan</button>
```

```ts
import 'camsense'                       // registers <camsense-scanner>
const cam = document.getElementById('cam')

cam.include = { images: 'best', metadata: true }       // default: no pictures, no metadata
go.onclick = async () => {
  await cam.start()                     // from a tap: opens the camera, prepares the task
  const result = await cam.scan()       // or listen for 'camsense-result'
  console.log(result.lines.map((l) => l.text))
  const { record, training } = await result.picture.toBlobs({
    record: { purpose: 'record' },      // WebP/JPEG, 1280 px, for documentation
    training: { purpose: 'training' },  // PNG, full size
  })
}
```

The element only shows the camera picture (with the aiming box, the cross and the boxes being read). It
has **no buttons**: the app draws its own and sets the element from code.

### Attributes

| Attribute | Values |
|---|---|
| `target` | `label` (8–20 cm) · `barcode` (8–25 cm) · `product` (30–100 cm) · `document` (20–40 cm) · `far` (1–5 m) |
| `task` | `text` · `barcode` · `photo` |
| `continuous` | present: keep scanning until `stop()`, with events per label or code |
| `assets` | URL where `camsense-copy-assets` put the files |
| `formats` | barcodes: e.g. `qr_code,data_matrix,ean_13` (default: all) |
| `magnification` | 1–4 |
| `gpu` | `off` to keep to the main processor |
| `touch` | `none` to ignore touches (default: a touch moves the cross there until the scan ends) |
| `mirror` | present: the picture is shown mirrored and read as shown, for text seen through glass from behind (the app's button; also the `mirrored` property) |

### Some options (`cam.options = { ... }`)

| Option | Values |
|---|---|
| `waitSteady`, `gyroThreshold`, `diffThreshold`, `steadyMs` | read only when the phone is steady |
| `fastConfidence`, `minLineConfidence` | continuous text: take a line from one frame; ignore logos |
| `cameraHeight`, `viewZoom`, `aimBox`, `distance` | camera picture, magnification, aiming box, scanning distance |

All of them: `ScanOptions` in `src/core/options.ts`.

### Properties and methods

| | |
|---|---|
| `options` | any scan option on top of the target preset (see `ScanOptions`) |
| `include` | `{ images: 'none' \| 'best' \| 'best+crops', metadata: boolean }` |
| `start()` | open the camera and prepare; call from a tap |
| `scan()` | run the task; single scans resolve with the result |
| `stop()` | end a continuous scan (its result follows) |
| `setTorch(on)`, `torchAvailable` | torch (Android) |
| `precisionHeld` | `true` while the app's precision button is held: only the line under the middle cross |
| `aimAt({ fx, fy } \| null)` | move the cross (shares of the element's size) |

### Events

`camsense-ready`, `camsense-result`, `camsense-label` (continuous text), `camsense-code` (continuous
barcodes), `camsense-steady`, `camsense-error`.

### Pictures

`result.picture` (and label pictures with `best+crops`) are references to frames already in memory;
a file is made only when asked: `toBlob({ purpose | format, maxSide, quality })`, `toBlobs({...})`,
`toDataURL()`, `pixels()`. Purposes: `thumbnail`, `record`, `sample`, `training`.

## Lab

`npm run lab` serves a test page over HTTPS on port 5444 (open it on a phone on the same network and
accept the certificate once). `npm test` runs the unit tests.
