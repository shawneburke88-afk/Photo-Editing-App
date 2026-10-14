import { lazy, Suspense, useState } from 'react'
import { CatalogCheck } from './CatalogCheck'
import { EnvironmentCheck } from './EnvironmentCheck'
import { FolderCheck } from './FolderCheck'
import { RawCheck } from './RawCheck'
import { ReportProvider, useReport } from './report'
import { SOURCE_URL } from '../lib/source'

// The GPU benchmark is loaded only when this page opens, so the main app doesn't carry it (PHASE3.md Part 16).
const Benchmark = lazy(() => import('../bench/Benchmark'))

export function SystemCheck() {
  return (
    <ReportProvider>
      <div className="page">
        <div className="page-intro">
          <h1>System Check</h1>
          <p>
            LightBench is in early development. These tests check that your computer and browser can handle a full photo
            library and RAW editing. Everything runs on your computer; no photos are uploaded anywhere.
          </p>
          <p className="muted">
            Run each test, then use <strong>Copy report</strong> at the bottom and paste the results back to the developer.
          </p>
          <p className="muted small">
            LightBench is free software (GPL-3.0; parts AGPL-3.0, see THIRD_PARTY_NOTICES.md in the source):{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">source code on GitHub</a>. This product includes DNG
            technology under license by Adobe.
          </p>
        </div>
        <EnvironmentCheck />
        <RawCheck />
        <FolderCheck />
        <CatalogCheck />
        <Suspense fallback={<section className="card"><h2>GPU benchmark</h2><p className="card-intro">Loading…</p></section>}>
          <Benchmark />
        </Suspense>
        <ReportBox />
      </div>
    </ReportProvider>
  )
}

function ReportBox() {
  const { sections } = useReport()
  const [copied, setCopied] = useState(false)
  const [startedAt] = useState(() => new Date().toISOString())
  const text = [
    `LightBench System Check — ${startedAt}`,
    `Version: ${__APP_VERSION__}`,
    ...Object.entries(sections).flatMap(([name, lines]) => ['', `## ${name}`, ...lines]),
  ].join('\n')

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="card">
      <header className="card-head">
        <h2>Report</h2>
        <button className="button primary" onClick={() => void copy()}>{copied ? 'Copied!' : 'Copy report'}</button>
      </header>
      <p className="card-intro">This is what will be copied. It contains no photos and no file contents.</p>
      <pre className="report">{text}</pre>
    </section>
  )
}
