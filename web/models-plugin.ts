// LightBench's AI models and their runtime (docs/PHASE3.md Part 24).
//
// - The pinned manifest (web/models/manifest.json) is checked and compiled into the app as `__LB_AI__`, so the app
//   knows each file's size and SHA-256 without asking the network (nothing is fetched before the user opts in).
// - The runtime, ONNX Runtime Web's WebAssembly file (from the exact npm version in package-lock.json), is copied into
//   the site at `ort/<version>/…` with its SHA-256 worked out here. The service worker leaves `ort/` and `models/` out
//   of its precache (sw-plugin.ts): they are downloaded only after the user opts in, then kept by the app (ai/store.ts).
// - The model files are not in git. The deploy workflow fetches them into `dist/models/` after the build and checks
//   their hashes (web/scripts/models.mjs). The dev server serves them from web/models/local/ (same layout, git-ignored).
//
// Test hook (never set by the deploy): LB_MODELS_MANIFEST names another manifest and LB_MODELS_DIR the folder its files
// are served from, so the end-to-end tests can run with a locally made stand-in model.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { Plugin } from 'vite'
import { parseManifest, servedPath, type AiInfo } from './src/ai/manifest.ts'

const ROOT = new URL('./', import.meta.url).pathname
const ORT_DIR = join(ROOT, 'node_modules/onnxruntime-web')
/** The native WebGPU build (also runs the WebAssembly CPU provider): `onnxruntime-web/webgpu`. */
export const ORT_WASM = 'ort-wasm-simd-threaded.asyncify.wasm'

function aiInfo(): { info: AiInfo; wasmFile: string; modelsDir: string } {
  const manifestPath = process.env.LB_MODELS_MANIFEST ?? join(ROOT, 'models/manifest.json')
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  const pkg = JSON.parse(readFileSync(join(ORT_DIR, 'package.json'), 'utf8')) as { version: string; license: string }
  const wasmFile = join(ORT_DIR, 'dist', ORT_WASM)
  const wasm = readFileSync(wasmFile)
  return {
    info: {
      models: manifest.models,
      runtime: {
        name: 'ONNX Runtime Web',
        version: pkg.version,
        licence: pkg.license,
        wasm: { path: `ort/${pkg.version}/${ORT_WASM}`, bytes: wasm.length, sha256: createHash('sha256').update(wasm).digest('hex') },
      },
    },
    wasmFile,
    modelsDir: process.env.LB_MODELS_DIR ?? join(ROOT, 'models/local'),
  }
}

export function aiModels(): Plugin {
  const { info, wasmFile, modelsDir } = aiInfo()
  const served = new Set(info.models.flatMap((m) => (m.source.revision ? m.files.map((f) => servedPath(m, f)) : [])))
  return {
    name: 'lightbench-ai-models',
    config() {
      return { define: { __LB_AI__: JSON.stringify(info) } }
    },
    configureServer(server) {
      const base = server.config.base
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (!path.startsWith(base)) return next()
        const rel = path.slice(base.length)
        let file: string | null = null
        if (rel === info.runtime.wasm.path) file = wasmFile
        else if (served.has(rel)) {
          const f = normalize(join(modelsDir, rel.slice('models/'.length)))
          if (f.startsWith(normalize(modelsDir)) && existsSync(f)) file = f
        }
        if (!file) return next()
        res.setHeader('Content-Type', rel.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.setHeader('Content-Length', String(statSync(file).size))
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: info.runtime.wasm.path, source: readFileSync(wasmFile) })
      // The runtime's licence and the notices of what is compiled into its WebAssembly (from its release tag), beside it;
      // upgrading ONNX Runtime needs that version's ThirdPartyNotices.txt in models/notices/ (the build fails without it).
      const dir = info.runtime.wasm.path.replace(/[^/]+$/, '')
      this.emitFile({ type: 'asset', fileName: `${dir}LICENSE.txt`, source: readFileSync(join(ROOT, 'models/notices/onnxruntime.LICENSE.txt')) })
      this.emitFile({ type: 'asset', fileName: `${dir}ThirdPartyNotices.txt`, source: readFileSync(join(ROOT, `models/notices/onnxruntime-${info.runtime.version}.ThirdPartyNotices.txt`)) })
    },
  }
}
