import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
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
  plugins: [react(), serviceWorker({ version, releases })],
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  // These packages locate their .wasm files at runtime; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', '@colorhythm/libraw-wasm'] },
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
