/**
 * Words read one by one (the Hebrew models find words, not lines) joined into the rows they stand
 * in: words whose centres are within half a word's height of each other across, and near enough
 * along (`gap` word heights between centres), are one row. Each row's words are in reading order
 * (right to left for `rtl`, unless the row has no right-to-left letters, such as a serial number) and
 * the row is as far from the cross as its nearest word.
 */
export interface RowWord {
  text: string
  x: number
  y: number
  h: number
  confidence: number
  d?: number
}

export interface Row {
  text: string
  confidence: number
  d?: number
}

/** Hebrew and Arabic letters. */
const RTL_LETTER = /[\u0590-\u08ff]/

export function joinRows(words: RowWord[], rtl: boolean, gap = 6): Row[] {
  const rows: RowWord[][] = []
  for (const w of [...words].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => {
      const y = r.reduce((s, v) => s + v.y, 0) / r.length
      const h = Math.max(w.h, ...r.map((v) => v.h))
      return Math.abs(w.y - y) < h / 2 && r.some((v) => Math.abs(v.x - w.x) <= gap * h)
    })
    if (row) row.push(w)
    else rows.push([w])
  }
  return rows.map((r) => {
    const right = rtl && r.some((v) => RTL_LETTER.test(v.text))
    const sorted = r.sort((a, b) => (right ? b.x - a.x : a.x - b.x))
    const ds = r.map((v) => v.d).filter((d): d is number => d !== undefined)
    return {
      text: sorted.map((v) => v.text).join(' '),
      confidence: Math.min(...r.map((v) => v.confidence)),
      d: ds.length ? Math.min(...ds) : undefined,
    }
  })
}
