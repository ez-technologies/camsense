/** How a finished scan is signalled: any of a beep, a vibration and a flash of the screen. */
export interface Feedback {
  beep: boolean
  vibrate: boolean
  flash: boolean
}

/** Beep and vibration unless the app says otherwise. */
export const DEFAULT_FEEDBACK: Feedback = { beep: true, vibrate: true, flash: false }

/**
 * Reads the `feedback` attribute: words among `beep`, `vibrate`, `flash` (any order, spaces or commas),
 * or `none`. Missing or empty: the default.
 */
export function parseFeedback(attr: string | null): Feedback {
  if (attr === null || !attr.trim()) return { ...DEFAULT_FEEDBACK }
  const words = attr.toLowerCase().split(/[\s,]+/).filter(Boolean)
  return { beep: words.includes('beep'), vibrate: words.includes('vibrate'), flash: words.includes('flash') }
}

/** A short beep. */
export function beep(audio: AudioContext) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.frequency.value = 1800
  gain.gain.setValueAtTime(0.25, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.09)
  osc.connect(gain).connect(audio.destination)
  osc.start()
  osc.stop(audio.currentTime + 0.1)
}

/** What a scan is doing, for the progress shown over the picture and the `camsense-progress` event. */
export type Phase = 'steady' | 'capture' | 'merge' | 'flatten' | 'read'

/**
 * Words shown for each phase; `{done}` and `{total}` are replaced. The app may set its own (another
 * language). While pictures are taken the bar shows how far along; the words only ask to hold still.
 */
export type ProgressText = Record<Phase, string>

export const PROGRESS_TEXT: ProgressText = {
  steady: 'Hold still',
  capture: 'Hold still',
  merge: 'Merging',
  flatten: 'Flattening',
  read: 'Reading',
}

/** The phase's words with its numbers filled in. */
export function progressLine(text: ProgressText, phase: Phase, done?: number, total?: number): string {
  return text[phase].replace('{done}', String(done ?? '')).replace('{total}', String(total ?? ''))
}
