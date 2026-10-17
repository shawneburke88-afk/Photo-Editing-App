import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { lensfun } from './lensfun-plugin.ts'
import { aiModels } from './models-plugin.ts'
import { noiseProfiles } from './noiseprofiles-plugin.ts'
import { serviceWorker } from './sw-plugin.ts'

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

const version = `${process.env.npm_package_version}+${commit}`
const releases = JSON.parse(readFileSync(new URL('./src/pwa/release-notes.json', import.meta.url), 'utf8'))

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/Photo-Editing-App/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // serviceWorker: offline use + COOP/COEP on GitHub Pages (production build only; see sw-plugin.ts).
  // lensfun: the Lensfun lens database as one JSON file, downloaded on first use (lensfun-plugin.ts).
  // noiseProfiles: darktable's noise profiles as one JSON file, downloaded on first use (noiseprofiles-plugin.ts).
  // aiModels: the pinned AI model manifest and ONNX Runtime's WebAssembly file, downloaded only on opt-in (models-plugin.ts).
  plugins: [react(), lensfun(), noiseProfiles(), aiModels(), serviceWorker({ version, releases })],
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  // These packages locate their .wasm files at runtime; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', '@colorhythm/libraw-wasm', 'lcms-wasm'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
