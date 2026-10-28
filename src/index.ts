// camsense: camera recognition for the browser.
// The <camsense-scanner> element is registered on import. The core is exported for apps that draw
// their own picture and call the tasks themselves.
export { CamsenseScanner } from './element/camsense-scanner'
export type { BarcodeResult, FocusStackResult, Label, Line, Metadata, PhotoResult, Result, TextResult, Task, ImagesWanted } from './element/camsense-scanner'
export { stackFocus, type StackResult, type StackOptions, type FrameFit } from './core/focusstack'
export { defaults, optionsFor, presets, type ScanOptions, type Target } from './core/options'
export { Picture, purposes, resolveFileOptions, fitSize, type FileOptions, type ImageFormat, type PictureFile, type Purpose } from './core/pictures'
export { setAssetsBase, loadEngine, hasWebGpu, groupLines, inTextOrder, LATIN_LABELS, type Engine, type ModelSet, type TextRead } from './core/ocr/engine'
export { canScan } from './core/camera'
export { bestShot, type BestShot, type BestShotOptions } from './core/photo'
export { barcodeReader, readBarcodes, type BarcodeRead } from './core/barcode'
export { words } from './core/continuous'
export { loadUnwarp, unwarpPage } from './core/unwarp'
