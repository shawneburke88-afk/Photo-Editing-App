import { describe, expect, it } from 'vitest'
import { compileSmart, dayStart } from './smart'

describe('compileSmart', () => {
  it('joins rules with AND for "all" and OR for "any", binding every value', () => {
    const all = compileSmart({ match: 'all', rules: [{ kind: 'rating', op: '>=', value: 4 }, { kind: 'flag', op: 'is', value: 'picked' }] })
    expect(all.sql).toBe('(p.rating >= ? AND p.flag = ?)')
    expect(all.bind).toEqual([4, 1])
    expect(compileSmart({ match: 'any', rules: [{ kind: 'label', op: 'isnot', value: 2 }, { kind: 'edited', op: 'is', value: false }] }).sql)
      .toBe('(p.color_label <> ? OR NOT EXISTS (SELECT 1 FROM edits e WHERE e.photo_id = p.id))')
  })

  it('never puts values into the SQL text', () => {
    const c = compileSmart({ match: 'all', rules: [{ kind: 'keyword', op: 'has', value: "x'); DROP TABLE photos;--" }] })
    expect(c.sql).not.toContain('DROP')
    expect(c.bind).toContain("x'); DROP TABLE photos;--")
  })

  it('turns dates into day boundaries', () => {
    const t = dayStart('2026-10-11')!
    expect(compileSmart({ match: 'all', rules: [{ kind: 'captured', op: 'on', value: '2026-10-11' }] }).bind).toEqual([t, t + 86400])
    expect(compileSmart({ match: 'all', rules: [{ kind: 'added', op: 'after', value: '2026-10-11' }] }).bind).toEqual([t + 86400])
    expect(compileSmart({ match: 'all', rules: [{ kind: 'added', op: 'last', value: 7 }] }, 1_000_000).bind).toEqual([1_000_000 - 7 * 86400])
  })

  it('skips incomplete rules and matches everything when none are usable', () => {
    expect(compileSmart({ match: 'all', rules: [{ kind: 'captured', op: 'on', value: '' }, { kind: 'keyword', op: 'has', value: ' ' }] }))
      .toEqual({ sql: '1', bind: [] })
  })

  it('handles folders and file types', () => {
    const c = compileSmart({ match: 'all', rules: [{ kind: 'folder', op: 'notin', value: { rootId: 2, path: 'Trip' } }, { kind: 'filetype', op: 'is', value: 'raw' }] })
    expect(c.sql).toContain('NOT p.folder_id IN')
    expect(c.sql).toContain("lower(p.file_type) NOT IN ('jpg', 'jpeg')")
    expect(c.bind).toEqual([2, 'Trip', 'Trip', 'Trip', 'Trip'])
  })
})
