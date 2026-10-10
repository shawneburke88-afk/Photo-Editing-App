import type { ReactNode } from 'react'

export type Status = 'pass' | 'warn' | 'fail' | 'idle' | 'running'

const LABEL: Record<Status, string> = {
  pass: 'Ready',
  warn: 'Limited',
  fail: 'Not available',
  idle: 'Not run yet',
  running: 'Running…',
}

export function Pill({ status, label }: { status: Status; label?: string }) {
  return <span className={`pill pill-${status}`}>{label ?? LABEL[status]}</span>
}

export function Card({ title, status, intro, children }: { title: string; status: Status; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        <Pill status={status} />
      </header>
      <p className="card-intro">{intro}</p>
      {children}
    </section>
  )
}

export function Facts({ rows }: { rows: [string, ReactNode, Status?][] }) {
  return (
    <dl className="facts">
      {rows.map(([k, v, s]) => (
        <div key={k} className="fact">
          <dt>{k}</dt>
          <dd>
            {s && <span className={`dot dot-${s}`} aria-hidden />}
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}
