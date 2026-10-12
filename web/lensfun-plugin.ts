// Serves LightBench's pinned copy of the Lensfun database (web/lensfun/: Lensfun's data/db/*.xml, unchanged, from
// the commit in web/lensfun/source.json; CC BY-SA 3.0) as one compact JSON file, converted at build time by
// src/engine/lens/lensfun-xml.ts: 5.1 MB of XML becomes about 2 MB of JSON (about 0.43 MB gzip-compressed).
//
// The XML stays in the repository as the source (it can be checked against Lensfun's own files); the JSON is made
// by every build, named after the Lensfun commit (`lensfun/lensfun-<commit>.json`), and served by the dev server.
// The service worker leaves it out of its precache (sw-plugin.ts), so it is downloaded only when a photo needs it
// (src/engine/lens/lens-db.ts).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parseLensfunXml, type LensfunData } from './src/engine/lens/lensfun-xml.ts'

const DIR = new URL('./lensfun/', import.meta.url).pathname

interface Source {
  repo: string
  commit: string
  date: string
  licence: string
}

function info() {
  const source = JSON.parse(readFileSync(join(DIR, 'source.json'), 'utf8')) as Source
  return { file: `lensfun/lensfun-${source.commit.slice(0, 7)}.json`, repo: source.repo, commit: source.commit, date: source.date, licence: source.licence }
}

/** The database as LightBench downloads it. */
export function lensfunJson(): string {
  const i = info()
  const data: LensfunData = { source: { repo: i.repo, commit: i.commit, date: i.date, licence: i.licence }, mounts: [], cameras: [], lenses: [] }
  const db = join(DIR, 'db')
  for (const f of readdirSync(db).filter((n) => n.endsWith('.xml')).sort()) parseLensfunXml(readFileSync(join(db, f), 'utf8'), data)
  return JSON.stringify(data)
}

export function lensfun(): Plugin {
  const i = info()
  let json: string | null = null
  const get = () => (json ??= lensfunJson())
  return {
    name: 'lightbench-lensfun',
    config() {
      return { define: { __LENSFUN_DB__: JSON.stringify(i) } }
    },
    configureServer(server) {
      const url = `${server.config.base}${i.file}`
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== url) return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(get())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: i.file, source: get() })
    },
  }
}
