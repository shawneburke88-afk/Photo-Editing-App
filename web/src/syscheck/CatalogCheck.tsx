import { useState } from 'react'
import { runCatalogBenchmark, type CatalogBenchResult } from '../engine/catalog/benchmark'
import { bytes, ms } from './format'
import { useReport } from './report'
import { Card, Facts, type Status } from './ui'

const PHOTOS = 50_000

export function CatalogCheck() {
  const { set } = useReport()
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<CatalogBenchResult | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setStatus('running')
    setError('')
    try {
      const r = await runCatalogBenchmark(PHOTOS)
      setResult(r)
      const slowestQuery = Math.max(...r.timings.slice(2).map((t) => t.ms))
      setStatus(r.storage === 'opfs-sahpool' && slowestQuery < 250 ? 'pass' : 'warn')
      set('Catalog', [
        `SQLite ${r.sqliteVersion}, storage ${r.storage}${r.storageNote ? ` (${r.storageNote})` : ''}, size ${bytes(r.dbSizeBytes)}`,
        ...r.timings.map((t) => `${t.label}: ${ms(t.ms)}${t.rows !== undefined ? ` (${t.rows} rows)` : ''}`),
      ])
    } catch (e) {
      setStatus('fail')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card
      title="Library catalog"
      status={status}
      intro={`LightBench keeps your ratings, keywords and collections in a database stored privately in this browser. This test builds a pretend library of ${PHOTOS.toLocaleString()} photos, times common searches, then deletes it.`}
    >
      <button className="button primary" onClick={() => void run()} disabled={status === 'running'}>
        {status === 'running' ? 'Running…' : 'Run catalog test'}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <Facts
          rows={[
            ['Storage', result.storage === 'opfs-sahpool' ? 'Saved in browser storage (survives restarts)' : `Memory only — ${result.storageNote}`, result.storage === 'opfs-sahpool' ? 'pass' : 'warn'],
            ...result.timings.map((t) => [t.label, `${ms(t.ms)}${t.rows !== undefined ? ` · ${t.rows.toLocaleString()} results` : ''}`, t.ms < 250 || t.label.startsWith('Insert') || t.label.startsWith('Build') ? 'pass' : 'warn'] as [string, string, Status]),
            ['Database size', bytes(result.dbSizeBytes)],
          ]}
        />
      )}
    </Card>
  )
}
