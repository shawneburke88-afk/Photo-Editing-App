# LightBench

An open-source, Lightroom-class photo editor and library manager that runs in your browser — with a
desktop app planned from the same code. Your photos never leave your computer.

**Try it:** https://shawneburke88-afk.github.io/Photo-Editing-App/ (best in Chrome or Edge)

- **Status:** Phase 0 — foundations. The site currently has a **System Check** page that tests RAW
  decoding, GPU editing, folder access and the catalog database on your computer.
- **License:** [GPL-3.0-or-later](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
- **Docs:** [Research summary](docs/RESEARCH.md) · [Project plan & roadmap](docs/PLAN.md) ·
  [Phase 0 results](docs/PHASE0.md)

## Developing

```sh
cd web
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run build      # type-checks, then builds to web/dist
```

Pushes to `main` are built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## Layout

```
web/                    Browser app (Vite + React + TypeScript)
  src/engine/raw/       RAW decoding (LibRaw in a Web Worker)
  src/engine/gpu/       WebGPU develop pipeline (WGSL shaders)
  src/engine/catalog/   SQLite catalog (in browser storage)
  src/platform/         Folder access (File System Access API)
  src/syscheck/         System Check page
docs/                   Research, plan, phase results
```
