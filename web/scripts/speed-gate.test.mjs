// The speed check's comparison (scripts/speed-gate.mjs): warnings only for a stage whose share of the run grew past
// the tolerance by enough milliseconds, for more memory, for a whole run far slower than the baseline, and for failed
// stages; a machine that is uniformly faster or slower gives none.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASELINE, SKIPPED_STAGES, baselineOf, compare, failedRows, limitsText, MIN_EXTRA_MS, SHARE_TOLERANCE, stageRows, summaryMarkdown, TOTAL_TOLERANCE } from './speed-gate.mjs'

const row = (id, median, peakBytes = 10 * 2 ** 20, extra = {}) => ({ id, stage: `Stage ${id}`, image: 'Bayer 0.30 MP (synthetic, scaled)', wall: { median, min: median, n: 3 }, gpu: null, peakBytes, ...extra })
const report = (rows, extra = {}) => ({ app: { version: '0.6.13+abc1234', commit: 'abc1234' }, date: '2026-10-21T00:00:00Z', mode: 'quick', scaledTo: 0.3, warmup: 1, runs: 3, adapter: { vendor: 'google', architecture: 'swiftshader' }, display: {}, rows, cancelled: false, ...extra })

const base = report([row('a', 1000), row('b', 500), row('c', 200), row('d', 20)])

describe('speed gate', () => {
  it('compares the measured stage rows only (not ↳ parts, failures or skips)', () => {
    const r = report([row('a', 1), { ...row('a.sub', 1), sub: true }, { ...row('x', 1), wall: null, error: 'boom' }, { ...row('y', 1), wall: null, error: 'skipped: no model' }])
    expect([...stageRows(r).keys()]).toEqual(['a'])
    expect(failedRows(r).map((f) => f.id)).toEqual(['x'])
  })

  it('gives no warning for the same run, or for a machine uniformly 1.8 times slower', () => {
    expect(compare(base, base).warnings).toEqual([])
    const slower = report(base.rows.map((r) => row(r.id, r.wall.median * 1.8, r.peakBytes)))
    const c = compare(slower, base)
    expect(c.warnings).toEqual([])
    expect(c.totalRatio).toBeCloseTo(1.8)
    expect(c.stages.every((s) => Math.abs(s.shareChange) < 1e-9)).toBe(true)
  })

  it('warns when one stage takes a larger share of the run, naming it', () => {
    const now = report([row('a', 400), row('b', 1500), row('c', 200), row('d', 20)])
    const c = compare(now, base)
    expect(c.stages.find((s) => s.id === 'b').status).toBe('slower')
    expect(c.warnings).toHaveLength(1)
    expect(c.warnings[0]).toMatch(/^Stage b \(Bayer 0\.30 MP/)
    // The other stages got a smaller share: not warnings.
    expect(c.stages.filter((s) => s.status !== 'ok').map((s) => s.id)).toEqual(['b'])
  })

  it('ignores a short stage’s growth under the minimum extra time (noise)', () => {
    const now = report([row('a', 1000), row('b', 500), row('c', 200), row('d', 20 + MIN_EXTRA_MS * 0.6)])
    const c = compare(now, base)
    expect(c.stages.find((s) => s.id === 'd').shareChange).toBeGreaterThan(SHARE_TOLERANCE)
    expect(c.warnings).toEqual([])
  })

  it('warns about more memory past 10 %, and not under it', () => {
    const now = report([row('a', 1000, 12 * 2 ** 20), row('b', 500, 10.5 * 2 ** 20), row('c', 200), row('d', 20)])
    const c = compare(now, base)
    expect(c.stages.find((s) => s.id === 'a').status).toBe('more memory')
    expect(c.stages.find((s) => s.id === 'b').status).toBe('ok')
    expect(c.warnings).toEqual([expect.stringMatching(/Stage a .* 20 % more GPU memory .*12\.0 MB instead of 10\.0 MB/)])
  })

  it('warns when the whole run takes more than the total tolerance', () => {
    const now = report(base.rows.map((r) => row(r.id, r.wall.median * (TOTAL_TOLERANCE + 0.5), r.peakBytes)))
    expect(compare(now, base).warnings).toEqual([expect.stringMatching(/^The whole run took 2\.5 times as long/)])
  })

  it('warns about failed stages and a cancelled run, not about the expected skips', () => {
    const now = report([...base.rows, { ...row('e', 0), wall: null, error: 'The graphics card ran out of memory.' }, { ...row('f', 0), wall: null, error: 'skipped: the AI Depth model isn’t on this device' }], { cancelled: true })
    const w = compare(now, base).warnings
    expect(w).toEqual(['Stage e failed: The graphics card ran out of memory.', 'The benchmark stopped before the end.'])
  })

  it('lists new and missing stages without warning', () => {
    const now = report([row('a', 1000), row('b', 500), row('c', 200), row('new', 50)])
    const c = compare(now, base)
    expect(c.stages.find((s) => s.id === 'new').status).toBe('new')
    expect(c.stages.find((s) => s.id === 'd').status).toBe('missing')
    expect(c.warnings).toEqual([])
    expect(c.compared).toBe(3)
  })

  it('writes a summary with the table, what it measures and what it can’t catch', () => {
    const now = report([row('a', 400), row('b', 1500), row('c', 200), row('d', 20)])
    const md = summaryMarkdown(now, base, compare(now, base))
    expect(md).toMatch(/^## Speed check\n\n\*\*1 warning\*\*/)
    expect(md).toContain('| Stage b | Bayer 0.30 MP (synthetic, scaled) | 500 ms | 1.50 s |')
    expect(md).toContain(limitsText(0.3))
    expect(md).toMatch(/never fails the build/)
    expect(md).toMatch(/speed-gate\.mjs baseline/)
  })

  it('keeps a baseline small: stage rows only, no user agent', () => {
    const b = baselineOf({ ...report([row('a', 1), { ...row('a.sub', 1), sub: true }]), userAgent: 'Mozilla/5.0 …', datasets: [] })
    expect(b.rows.map((r) => r.id)).toEqual(['a'])
    expect(JSON.stringify(b)).not.toContain('Mozilla')
    // Round trip through a file, as the command line does.
    const dir = mkdtempSync(join(tmpdir(), 'speed-'))
    writeFileSync(join(dir, 'b.json'), JSON.stringify(b))
    expect(compare(report([row('a', 1)]), JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8'))).warnings).toEqual([])
  })

  it('has a committed baseline of the Quick plan at the check’s size, without failures', () => {
    const b = JSON.parse(readFileSync(BASELINE, 'utf8'))
    expect(b.mode).toBe('quick')
    expect(b.scaledTo).toBe(0.3)
    expect(stageRows(b).size).toBeGreaterThan(20)
    expect(failedRows(b)).toEqual([])
    // The rows the check leaves out to stay short aren't in it.
    for (const id of stageRows(b).keys()) expect(SKIPPED_STAGES).not.toContain(id.split('.')[1])
  })
})
