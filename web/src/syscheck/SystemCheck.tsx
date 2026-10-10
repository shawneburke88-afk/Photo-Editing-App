import { useState } from 'react'
import { CatalogCheck } from './CatalogCheck'
import { EnvironmentCheck } from './EnvironmentCheck'
import { FolderCheck } from './FolderCheck'
import { RawCheck } from './RawCheck'
import { ReportProvider, useReport } from './report'

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
        </div>
        <EnvironmentCheck />
        <RawCheck />
        <FolderCheck />
        <CatalogCheck />
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
