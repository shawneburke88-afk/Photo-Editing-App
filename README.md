# LightBench

An open-source, Lightroom-class photo editor and library manager that runs in your browser — with a
desktop app planned from the same code. Your photos never leave your computer.

**Try it:** https://shawneburke88-afk.github.io/Photo-Editing-App/ (best in Chrome or Edge)

- **Status:** Phase 1, Part 1. **Import** photos from a memory card or folder and organise them in the
  **Library** (folders, ratings, flags, colour labels, filters, loupe). **Develop** (editing) is next.
  A **System Check** page tests your computer and browser.
- **License:** [GPL-3.0-or-later](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
- **Docs:** [Research summary](docs/RESEARCH.md) · [Project plan & roadmap](docs/PLAN.md) ·
  [Phase 0 results](docs/PHASE0.md)

## Developing

```sh
cd web
npm install
npm run dev        # http://localhost:5173
npm run lint
npm test           # unit tests (Vitest)
npm run build      # type-checks, then builds to web/dist
```

Pushes to `main` are built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## Layout

```
web/                    Browser app (Vite + React + TypeScript)
  src/engine/raw/       RAW decoding (LibRaw in a Web Worker)
  src/engine/gpu/       WebGPU develop pipeline (WGSL shaders)
  src/engine/catalog/   Catalog benchmark (System Check)
  src/engine/meta/      EXIF reader for JPEGs
  src/catalog/          Library catalog: SQLite in browser storage, thumbnails
  src/import/           Import window: scanning, duplicate detection, copying
  src/library/          Library module: folders, grid, loupe, filters, info panel
  src/platform/         Folder access and library roots (File System Access API)
  src/syscheck/         System Check page
docs/                   Research, plan, phase results
```
