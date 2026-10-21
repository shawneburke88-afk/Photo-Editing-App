// "Check for updates" in Settings → AI models (docs/PHASE3.md Part 26; owner's decision 2026-10-21): manual only,
// nothing runs by itself, and it only reports. LightBench keeps using the files it pins (the ones it was tested with).
//
// It asks Hugging Face's Hub API, anonymously (no token), for the current files of the conversion LightBench uses and
// of the original weights it was made from (`/api/models/<repo>?blobs=true`, the current main branch: each file's Git LFS sha256),
// and compares the hashes of those files. Not the repositories' commit (`sha`): a commit that only edits a README
// changes it, which would report an update that isn't one.

import type { ModelEntry } from './manifest'

export interface UpdateCheck {
  /** "same": the pinned files are still the published ones; "newer": a file differs; "gone": a file isn't published. */
  conversion: 'same' | 'newer' | 'gone'
  /** The original weights the conversion was made from (when the manifest names them). */
  upstream: 'same' | 'newer' | 'gone' | null
  /** Files whose published hash differs from the pinned one (repo/path). */
  changed: string[]
  /** In plain words, for the panel. */
  message: string
  at: number
}

interface Sibling {
  rfilename?: string
  lfs?: { sha256?: string; size?: number }
}

const API = 'https://huggingface.co/api/models/'

async function siblings(repo: string, f: typeof fetch, signal?: AbortSignal): Promise<Map<string, Sibling>> {
  const r = await f(`${API}${repo}?blobs=true`, { signal, cache: 'no-store', credentials: 'omit' })
  if (r.status === 429) throw new Error('Hugging Face asked to wait (too many requests from this network); try again in a few minutes')
  if (!r.ok) throw new Error(`Hugging Face answered HTTP ${r.status} for ${repo}`)
  const j = (await r.json()) as { siblings?: Sibling[] }
  if (!Array.isArray(j.siblings)) throw new Error(`Hugging Face’s answer for ${repo} lists no files`)
  return new Map(j.siblings.filter((s) => typeof s.rfilename === 'string').map((s) => [s.rfilename!, s]))
}

/** Compares the pinned files with what Hugging Face publishes now. Only on the user's click. */
export async function checkForUpdates(m: ModelEntry, f: typeof fetch = (...a) => globalThis.fetch(...a), signal?: AbortSignal): Promise<UpdateCheck> {
  const changed: string[] = []
  let conversion: UpdateCheck['conversion'] = 'same'
  const pub = await siblings(m.source.repo, f, signal)
  for (const file of m.files) {
    const s = pub.get(file.path)
    if (!s?.lfs?.sha256) conversion = 'gone'
    else if (s.lfs.sha256 !== file.sha256) {
      if (conversion === 'same') conversion = 'newer'
      changed.push(`${m.source.repo}/${file.path}`)
    }
  }
  let upstream: UpdateCheck['upstream'] = null
  const up = m.updates?.upstream
  if (up) {
    const s = (await siblings(up.repo, f, signal)).get(up.path)
    upstream = !s?.lfs?.sha256 ? 'gone' : s.lfs.sha256 !== up.sha256 ? 'newer' : 'same'
    if (upstream === 'newer') changed.push(`${up.repo}/${up.path}`)
  }
  const keep = 'not installed: LightBench keeps the files it was tested with'
  const parts: string[] = []
  if (conversion === 'newer') parts.push(`A newer conversion of ${m.name} is published (${keep}).`)
  if (conversion === 'gone') parts.push(`Some of the files LightBench uses are no longer listed on Hugging Face. The copy on this device keeps working; a new download may not be possible.`)
  if (upstream === 'newer') parts.push(`The original ${m.name} weights have changed since this conversion was made (${keep}).`)
  if (upstream === 'gone') parts.push(`The original ${m.name} weights LightBench’s files were made from are no longer listed (nothing changes here).`)
  const message = parts.length ? parts.join(' ') : `No newer files: ${m.name} is the latest published version.`
  return { conversion, upstream, changed, message, at: Date.now() }
}
