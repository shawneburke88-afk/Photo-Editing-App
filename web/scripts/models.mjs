// LightBench's AI model files: fetched by exact URL and checked by SHA-256 (docs/PHASE3.md Part 24).
//
//   node scripts/models.mjs fetch --out dist [--from DIR]
//       The deploy workflow, after `npm run build`: downloads every pinned file of web/models/manifest.json from
//       https://huggingface.co/<repo>/resolve/<revision>/<path>, checks its byte count and SHA-256 and writes it to
//       dist/models/<id>/<revision 7>/<variant>.onnx (what the app downloads, on the user's opt-in). Any mismatch
//       fails the build. A model that isn't pinned yet is skipped with a warning (the app then says it isn't available).
//       --from DIR reads the files from DIR (same layout as under dist/models/) instead of downloading: a dry run.
//   node scripts/models.mjs verify --dir DIR
//       Checks files laid out as under dist/models/ against the manifest (no network).
//   node scripts/models.mjs show [--markdown]
//       Prints each model's source commit and files (sizes and SHA-256), as plain lines or a Markdown table (the
//       "AI models" workflow's log and summary).
//   node scripts/models.mjs pin [--revision COMMIT] [--save DIR]
//       For the owner, on a machine that can reach huggingface.co: takes the repository's current commit (or the one
//       given), reads each file's Git LFS pointer (its sha256 and size) at that commit, downloads the file, checks it
//       against the pointer, and writes the revision, sizes and hashes into the manifest. --save keeps the files (e.g.
//       in models/local for the dev server).
//
// The checks are kept in sync with src/ai/manifest.ts (same layout, same hash format).

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MANIFEST = join(HERE, '../models/manifest.json')
/** GitHub Pages: "Published GitHub Pages sites may be no larger than 1 GB." */
export const PAGES_LIMIT = 1e9

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
export const pinned = (m, f) => /^[0-9a-f]{40}$/.test(m.source?.revision ?? '') && /^[0-9a-f]{64}$/.test(f.sha256 ?? '')
export const servedPath = (m, f) => `models/${m.id}/${m.source.revision.slice(0, 7)}/${f.variant}.onnx`
export const sourceUrl = (m, f) => `https://huggingface.co/${m.source.repo}/resolve/${m.source.revision}/${f.path}`
export const pointerUrl = (m, f, rev) => `https://huggingface.co/${m.source.repo}/raw/${rev}/${f.path}`

/** The files to fetch, and the models skipped because they aren't pinned. */
export function plan(manifest) {
  const files = []
  const unpinned = []
  for (const m of manifest.models) {
    for (const f of m.files) {
      if (pinned(m, f)) files.push({ model: m, file: f, url: sourceUrl(m, f), path: servedPath(m, f) })
      else unpinned.push(`${m.id} ${f.variant}`)
    }
  }
  return { files, unpinned }
}

/** Null when `buf` is the pinned file, else why not. */
export function check(buf, f) {
  if (buf.length !== f.bytes) return `${buf.length} bytes, expected ${f.bytes}`
  const got = sha256(buf)
  if (got !== f.sha256) return `SHA-256 ${got}, expected ${f.sha256}`
  return null
}

/** A Git LFS pointer file ("version …\noid sha256:<hex>\nsize <n>\n"): its hash and size. */
export function parsePointer(text) {
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)
  const size = /^size (\d+)$/m.exec(text)
  if (!/^version https:\/\/git-lfs\.github\.com\/spec\/v1$/m.test(text) || !oid || !size) throw new Error('not a Git LFS pointer')
  return { sha256: oid[1], bytes: Number(size[1]) }
}

/** Total size of a folder (for the Pages limit). */
export function folderBytes(dir) {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size
  return n
}

export async function download(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 2000 * i))
    }
  }
}

const arg = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`)

export async function fetchModels(manifest, out, from) {
  const { files, unpinned } = plan(manifest)
  for (const u of unpinned) warn(`AI model ${u} is not pinned (no revision or SHA-256 in web/models/manifest.json): not deployed. See docs/PHASE3.md Part 24.`)
  let bad = 0
  for (const x of files) {
    const buf = from ? readFileSync(join(from, x.path.slice('models/'.length))) : await download(x.url)
    const why = check(buf, x.file)
    if (why) {
      console.error(`${x.model.id} ${x.file.variant} (${from ? 'local' : x.url}): ${why}`)
      bad++
      continue
    }
    const dest = join(out, x.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    console.log(`ok ${x.path} ${buf.length} bytes sha256 ${x.file.sha256}`)
  }
  if (bad) throw new Error(`${bad} model file(s) did not match the manifest`)
  // Each deployed model's licence goes next to it (Apache-2.0 §4(a): recipients get a copy of the licence).
  for (const m of new Set(files.map((x) => x.model))) {
    if (!m.licence?.file) continue
    const dest = join(out, `models/${m.id}/LICENSE.txt`)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, readFileSync(join(HERE, '../models', m.licence.file)))
  }
  if (existsSync(out)) {
    const total = folderBytes(out)
    console.log(`site size ${total} bytes`)
    if (total > PAGES_LIMIT) throw new Error(`the site would be ${total} bytes, over GitHub Pages' 1 GB limit`)
  }
  return files.length
}

export function verifyModels(manifest, dir) {
  const { files, unpinned } = plan(manifest)
  for (const u of unpinned) warn(`${u} is not pinned`)
  let bad = 0
  for (const x of files) {
    const p = join(dir, x.path.slice('models/'.length))
    if (!existsSync(p)) {
      console.error(`missing ${p}`)
      bad++
      continue
    }
    const why = check(readFileSync(p), x.file)
    if (why) {
      console.error(`${p}: ${why}`)
      bad++
    } else console.log(`ok ${p}`)
  }
  return bad
}

/** The manifest's pins, as plain lines or Markdown. */
export function describePins(manifest, markdown = false) {
  const out = []
  for (const m of manifest.models) {
    if (markdown) {
      out.push(`\`${m.source.repo}\` @ \`${m.source.revision ?? 'not pinned'}\``, '', '| file | path | bytes | SHA-256 |', '|---|---|---|---|')
      for (const f of m.files) out.push(`| ${f.variant} | \`${f.path}\` | ${f.bytes} | ${f.sha256 ? `\`${f.sha256}\`` : 'not pinned'} |`)
      out.push('')
    } else {
      out.push(`${m.id}: ${m.source.repo} @ ${m.source.revision ?? 'not pinned'}`)
      for (const f of m.files) out.push(`  ${f.variant} ${f.path} ${f.bytes} bytes sha256 ${f.sha256 ?? 'not pinned'}`)
    }
  }
  return out.join('\n')
}

async function pin(manifest, revision, save, path = MANIFEST) {
  for (const m of manifest.models) {
    let rev = revision
    if (!rev) {
      // The Hub API's model info carries the commit as `sha` (not checked from this build machine: huggingface.co
      // was blocked; pass --revision to pin a commit read elsewhere).
      for (const u of [`https://huggingface.co/api/models/${m.source.repo}/revision/main`, `https://huggingface.co/api/models/${m.source.repo}`]) {
        const r = await fetch(u)
        if (r.ok) rev = (await r.json()).sha
        if (rev) break
      }
    }
    if (!/^[0-9a-f]{40}$/.test(rev ?? '')) throw new Error(`${m.id}: no commit found`)
    for (const f of m.files) {
      const r = await fetch(pointerUrl(m, f, rev))
      if (!r.ok) throw new Error(`${pointerUrl(m, f, rev)}: HTTP ${r.status}`)
      const ptr = parsePointer(await r.text())
      const buf = await download(`https://huggingface.co/${m.source.repo}/resolve/${rev}/${f.path}`)
      const got = sha256(buf)
      if (buf.length !== ptr.bytes || got !== ptr.sha256) throw new Error(`${m.id} ${f.variant}: download (${buf.length}, ${got}) doesn't match its LFS pointer (${ptr.bytes}, ${ptr.sha256})`)
      f.bytes = ptr.bytes
      f.sha256 = ptr.sha256
      console.log(`${m.id} ${f.variant}: ${f.bytes} bytes sha256 ${f.sha256}`)
      if (save) {
        const dest = join(save, `${m.id}/${rev.slice(0, 7)}/${f.variant}.onnx`)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, buf)
      }
    }
    m.source.revision = rev
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${path}`)
}

async function main(args) {
  const path = arg(args, '--manifest') ?? MANIFEST
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const cmd = args[0]
  if (cmd === 'fetch') {
    const out = arg(args, '--out')
    if (!out) throw new Error('fetch needs --out DIR')
    await fetchModels(manifest, out, arg(args, '--from'))
  } else if (cmd === 'verify') {
    const dir = arg(args, '--dir')
    if (!dir) throw new Error('verify needs --dir DIR')
    if (verifyModels(manifest, dir)) process.exit(1)
  } else if (cmd === 'show') {
    console.log(describePins(manifest, args.includes('--markdown')))
  } else if (cmd === 'pin') {
    await pin(manifest, arg(args, '--revision'), arg(args, '--save'), path)
  } else {
    throw new Error('usage: models.mjs fetch --out DIR [--from DIR] | verify --dir DIR | show [--markdown] | pin [--revision COMMIT] [--save DIR]')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
