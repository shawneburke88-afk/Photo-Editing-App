// Serves LightBench's pinned copy of darktable's noise profiles (web/noiseprofiles/noiseprofiles.json: darktable's
// data/noiseprofiles.json, unchanged, from the commit in web/noiseprofiles/source.json; GPL-3.0-or-later like
// LightBench) as one compact JSON file, converted at build time by src/engine/detail/noiseprofiles.ts: 1.82 MB
// (544 kB gzip-compressed) becomes about 0.73 MB (about 0.27 MB gzip) — profile names and comments dropped, values
// as darktable's floats. The same way as the Lensfun data (lensfun-plugin.ts): named after the darktable commit
// (`noiseprofiles/noiseprofiles-<commit>.json`), left out of the service worker's precache (sw-plugin.ts) and
// downloaded the first time noise reduction is used (src/engine/detail/noise-db.ts).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { compactNoiseProfiles } from './src/engine/detail/noiseprofiles.ts'

const DIR = new URL('./noiseprofiles/', import.meta.url).pathname

interface Source {
  repo: string
  commit: string
  date: string
  licence: string
}

function info() {
  const source = JSON.parse(readFileSync(join(DIR, 'source.json'), 'utf8')) as Source
  return { file: `noiseprofiles/noiseprofiles-${source.commit.slice(0, 7)}.json`, repo: source.repo, commit: source.commit, date: source.date, licence: source.licence }
}

/** The profiles as LightBench downloads them. */
export function noiseProfilesJson(): string {
  const i = info()
  const data = compactNoiseProfiles(readFileSync(join(DIR, 'noiseprofiles.json'), 'utf8'), { repo: i.repo, commit: i.commit, date: i.date, licence: i.licence })
  return JSON.stringify(data)
}

export function noiseProfiles(): Plugin {
  const i = info()
  let json: string | null = null
  const get = () => (json ??= noiseProfilesJson())
  return {
    name: 'lightbench-noiseprofiles',
    config() {
      return { define: { __NOISE_PROFILES__: JSON.stringify(i) } }
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
