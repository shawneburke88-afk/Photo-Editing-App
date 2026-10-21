// What a browser on LightBench's site would get from Hugging Face, checked from GitHub's servers (which can reach
// huggingface.co; the build machine can't). Run by the "AI models" workflow's hf-check task; read-only, commits nothing.
//
//   node scripts/hf-check.mjs [--origin https://shawneburke88-afk.github.io] [--summary FILE]
//
// For each file: the /resolve/ response without following the redirect (status, redirect host, CORS headers), the
// redirect target's answer to a cross-origin GET and to a Range request (status, CORS, Accept-Ranges, Content-Length,
// whether the body is the requested 100 bytes), and the CORS preflight a browser sends before a Range request. For
// each repository: the Hub API answer the update check would read (sha, lastModified, per-file LFS sha256), with CORS.
// Browsers enforce CORS, Node doesn't: these are the headers a browser would decide on, not a browser run.

import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const ORIGIN = opt('--origin', 'https://shawneburke88-afk.github.io')
const SUMMARY = opt('--summary', process.env.GITHUB_STEP_SUMMARY ?? '')

// The ONNX conversion of Moebius the owner chose (2026-10-21), at the commit to pin, and its upstream.
const ONNX = { repo: 'simonw/Moebius-ONNX', revision: '5bf1ef5d2861ec01a727183a3f95dc64f352120e' }
const FILES = ['vae_encoder.onnx', 'vae_decoder.onnx', 'unet.onnx']
const UPSTREAM = 'hustvl/Moebius'

const HEADERS = ['access-control-allow-origin', 'access-control-expose-headers', 'access-control-allow-headers',
  'access-control-allow-methods', 'accept-ranges', 'content-length', 'content-range', 'content-type', 'etag',
  'x-linked-size', 'x-linked-etag', 'x-repo-commit', 'ratelimit', 'ratelimit-policy', 'cache-control']

const pick = (res) => Object.fromEntries(HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]))
const host = (url) => { try { return new URL(url).host } catch { return null } }

async function req(url, init = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { redirect: 'manual', ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } })
    let bodyBytes = null
    if (init.readBody) bodyBytes = (await res.arrayBuffer()).byteLength
    else await res.body?.cancel()
    return { status: res.status, location: res.headers.get('location'), headers: pick(res), bodyBytes, ms: Date.now() - t0 }
  } catch (e) {
    return { error: String(e), ms: Date.now() - t0 }
  }
}

async function checkFile(file) {
  const url = `https://huggingface.co/${ONNX.repo}/resolve/${ONNX.revision}/${file}`
  const out = { file, url }
  out.resolve = await req(url)
  out.resolvePreflight = await req(url, {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
  })
  const target = out.resolve.location ? new URL(out.resolve.location, url).href : null
  out.redirectHost = target ? host(target) : null
  if (target) {
    out.targetGet = await req(target) // headers only; the body is cancelled
    out.targetRange = await req(target, { headers: { Range: 'bytes=0-99' }, readBody: true })
    out.targetPreflight = await req(target, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
    })
  }
  out.pointer = await req(`https://huggingface.co/${ONNX.repo}/raw/${ONNX.revision}/${file}`, { readBody: true })
  return out
}

async function api(path) {
  const url = `https://huggingface.co/api/models/${path}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: { Origin: ORIGIN } })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    const siblings = (json?.siblings ?? []).map((s) => ({ rfilename: s.rfilename, size: s.size ?? null,
      lfsSha256: s.lfs?.sha256 ?? null, lfsSize: s.lfs?.size ?? null, blobId: s.blobId ?? null }))
    return { url, status: res.status, headers: pick(res), ms: Date.now() - t0,
      sha: json?.sha ?? null, lastModified: json?.lastModified ?? null, createdAt: json?.createdAt ?? null,
      license: json?.cardData?.license ?? json?.tags?.find((t) => t.startsWith('license:')) ?? null,
      keys: json ? Object.keys(json) : null, siblings: siblings.filter((s) => s.lfsSha256 || /\.(onnx|bin|safetensors|json)$/.test(s.rfilename)).slice(0, 60),
      error: json ? null : text.slice(0, 300) }
  } catch (e) {
    return { url, error: String(e) }
  }
}

const results = { origin: ORIGIN, at: new Date().toISOString(), files: [], api: {} }
for (const f of FILES) results.files.push(await checkFile(f))
results.api.onnxAtPin = await api(`${ONNX.repo}/revision/${ONNX.revision}?blobs=true`)
results.api.onnxMain = await api(`${ONNX.repo}?blobs=true`)
results.api.onnxPlain = await api(ONNX.repo)
results.api.upstreamMain = await api(`${UPSTREAM}?blobs=true`)

console.log(JSON.stringify(results, null, 2))

if (SUMMARY) {
  const L = []
  L.push('## Hugging Face: what a browser on LightBench\'s site would get', '', `Origin sent: \`${ORIGIN}\`. Node, not a browser: CORS headers are reported, not enforced.`, '')
  L.push('| File | /resolve/ | Redirect host | ACAO (resolve) | GET target | ACAO (target) | Accept-Ranges | Range 0-99 | Range body | Preflight (target) |', '|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results.files) {
    const a = (x) => x?.headers?.['access-control-allow-origin'] ?? (x?.error ? 'error' : '—')
    L.push(`| ${r.file} | ${r.resolve.status ?? r.resolve.error} | ${r.redirectHost ?? '—'} | ${a(r.resolve)} | ${r.targetGet?.status ?? '—'} | ${a(r.targetGet)} | ${r.targetGet?.headers?.['accept-ranges'] ?? '—'} | ${r.targetRange?.status ?? '—'} | ${r.targetRange?.bodyBytes ?? '—'} B | ${r.targetPreflight?.status ?? '—'} ${r.targetPreflight?.headers?.['access-control-allow-headers'] ?? ''} |`)
  }
  L.push('', '| API call | Status | ACAO | sha | lastModified | LFS files listed |', '|---|---|---|---|---|---|')
  for (const [k, v] of Object.entries(results.api)) {
    L.push(`| ${k} | ${v.status ?? v.error} | ${v.headers?.['access-control-allow-origin'] ?? '—'} | ${v.sha ?? '—'} | ${v.lastModified ?? '—'} | ${v.siblings?.filter((s) => s.lfsSha256).length ?? 0} |`)
  }
  L.push('', '<details><summary>Full JSON</summary>', '', '```json', JSON.stringify(results, null, 2), '```', '', '</details>', '')
  appendFileSync(SUMMARY, L.join('\n'))
}
