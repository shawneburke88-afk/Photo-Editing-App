// Builds sw.js (LightBench's service worker, web/src/pwa/sw.ts) after the rest of the site is written:
// it lists every file in the output folder with a hash of its contents, so the worker can download the
// whole app for offline use, and any change to any file changes sw.js (which is how browsers notice an
// update). The new build's version and release notes go in too, for the "Update ready" notice.
//
// Hand-written rather than vite-plugin-pwa/Workbox because the worker must also add the COOP/COEP headers
// (see sw.ts), and only one service worker can control the site; the precaching itself is small.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { transformWithOxc, type Plugin, type ResolvedConfig } from 'vite'

export interface SwBuildInfo {
  version: string
  releases: unknown[]
}

const SOURCE = new URL('./src/pwa/sw.ts', import.meta.url)

/** Same as the worker's `revision`: the first 16 hex digits of the SHA-256. */
const revision = (data: Buffer | string) => createHash('sha256').update(data).digest('hex').slice(0, 16)

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)],
  )
}

export function serviceWorker(build: SwBuildInfo): Plugin {
  let config: ResolvedConfig
  return {
    name: 'lightbench-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    writeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const outDir = resolve(config.root, config.build.outDir)
        const precache = filesIn(outDir)
          .map((file) => relative(outDir, file).split(sep).join('/'))
          .filter((url) => url !== 'sw.js')
          .sort()
          .map((url) => ({ url, rev: revision(readFileSync(join(outDir, url))) }))
        const cache = `lightbench-${revision(JSON.stringify({ precache, build }))}`

        const source = readFileSync(SOURCE, 'utf8')
        const { code } = await transformWithOxc(source, 'sw.ts', { lang: 'ts' }) // throws on syntax errors
        // The worker is a classic script: drop the `export {}` left by its type-only import.
        const body = code.replace(/^export \{\};?\s*$/m, '')
        if (/^\s*(import|export)\b/m.test(body)) throw new Error('sw.ts must not import or export anything at runtime')
        const out = body
          .replaceAll('__LB_PRECACHE__', JSON.stringify(precache))
          .replaceAll('__LB_CACHE__', JSON.stringify(cache))
          .replaceAll('__LB_BUILD__', JSON.stringify(build))
        writeFileSync(join(outDir, 'sw.js'), `// LightBench service worker, built from web/src/pwa/sw.ts (GPL-3.0-or-later).\n${out}`)
        config.logger.info(`sw.js: ${precache.length} files precached as ${cache}`)
      },
    },
  }
}
