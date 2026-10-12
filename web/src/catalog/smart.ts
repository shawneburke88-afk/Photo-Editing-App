// Smart collections: saved searches. Like Lightroom's ("Match all / any of the following rules"), with rule
// kinds chosen by the owner: rating, flag, label, keyword, folder, capture/added dates, edited, file type.
// darktable's collect module offers the same kinds of property filters (src/common/collection.h) combined with
// AND / OR / AND NOT per line; "match all/any" is the simpler, more familiar form.
//
// Rules compile to an SQL condition on `photos p` with bound parameters only (never interpolated values).

export type SmartRule =
  | { kind: 'rating'; op: '>=' | '<=' | '='; value: number }
  | { kind: 'flag'; op: 'is' | 'isnot'; value: 'picked' | 'rejected' | 'unflagged' }
  | { kind: 'label'; op: 'is' | 'isnot'; value: number }
  | { kind: 'keyword'; op: 'has' | 'hasnot'; value: string }
  | { kind: 'folder'; op: 'in' | 'notin'; value: { rootId: number; path: string } }
  | { kind: 'captured' | 'added'; op: 'after' | 'before' | 'on'; value: string }
  | { kind: 'captured' | 'added'; op: 'last'; value: number }
  | { kind: 'edited'; op: 'is'; value: boolean }
  | { kind: 'filetype'; op: 'is'; value: 'raw' | 'jpeg' }

export interface SmartRules {
  match: 'all' | 'any'
  rules: SmartRule[]
}

export interface Compiled {
  sql: string
  bind: (string | number)[]
}

const DAY = 86400

/** "2026-10-11" → Unix seconds at 00:00 UTC (capture times are camera-local read as UTC). */
export function dayStart(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000
  return Number.isFinite(t) ? t : null
}

const FLAG_VALUE = { picked: 1, rejected: -1, unflagged: 0 } as const

function compileRule(r: SmartRule, now: number): Compiled | null {
  switch (r.kind) {
    case 'rating':
      return { sql: `p.rating ${r.op} ?`, bind: [Math.max(0, Math.min(5, Math.round(r.value)))] }
    case 'flag':
      return { sql: `p.flag ${r.op === 'is' ? '=' : '<>'} ?`, bind: [FLAG_VALUE[r.value]] }
    case 'label':
      return { sql: `p.color_label ${r.op === 'is' ? '=' : '<>'} ?`, bind: [Math.max(0, Math.min(5, Math.round(r.value)))] }
    case 'keyword': {
      if (!r.value.trim()) return null
      const has = `EXISTS (SELECT 1 FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id = p.id
        AND (lower(k.path) = lower(?) OR substr(lower(k.path), 1, length(?) + 1) = lower(?) || '|'))`
      return { sql: r.op === 'has' ? has : `NOT ${has}`, bind: [r.value, r.value, r.value] }
    }
    case 'folder': {
      const inside = `p.folder_id IN (SELECT id FROM folders WHERE root_id = ? AND (? = '' OR path = ? OR substr(path, 1, length(?) + 1) = ? || '/'))`
      const { rootId, path } = r.value
      return { sql: r.op === 'in' ? inside : `NOT ${inside}`, bind: [rootId, path, path, path, path] }
    }
    case 'captured':
    case 'added': {
      const col = r.kind === 'captured' ? 'p.captured_at' : 'p.imported_at'
      if (r.op === 'last') {
        const days = Math.max(1, Math.round(r.value))
        return { sql: `${col} >= ?`, bind: [now - days * DAY] }
      }
      const t = dayStart(r.value)
      if (t === null) return null
      if (r.op === 'after') return { sql: `${col} >= ?`, bind: [t + DAY] }
      if (r.op === 'before') return { sql: `${col} < ?`, bind: [t] }
      return { sql: `(${col} >= ? AND ${col} < ?)`, bind: [t, t + DAY] }
    }
    case 'edited':
      return { sql: `${r.value ? '' : 'NOT '}EXISTS (SELECT 1 FROM edits e WHERE e.photo_id = p.id)`, bind: [] }
    case 'filetype':
      return { sql: `lower(p.file_type) ${r.value === 'jpeg' ? '' : 'NOT '}IN ('jpg', 'jpeg')`, bind: [] }
  }
}

/** The SQL condition for a smart collection. Incomplete rules are skipped; no usable rule matches every photo. */
export function compileSmart(s: SmartRules, now = Math.floor(Date.now() / 1000)): Compiled {
  const parts = s.rules.map((r) => compileRule(r, now)).filter((c): c is Compiled => c !== null)
  if (!parts.length) return { sql: '1', bind: [] }
  return {
    sql: `(${parts.map((p) => p.sql).join(s.match === 'all' ? ' AND ' : ' OR ')})`,
    bind: parts.flatMap((p) => p.bind),
  }
}
