import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/Photo-Editing-App/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(`${process.env.npm_package_version}+${commit}`) },
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
