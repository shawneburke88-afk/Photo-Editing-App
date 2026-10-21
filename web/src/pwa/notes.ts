// Release notes shown in the app (owner's release rules, docs/PLAN.md "Every release"): each release lists
// its new features and bug fixes. The list lives in release-notes.json, newest first; its first entry must
// match package.json's version (checked by notes.test.ts), so a release means bumping both.
//
// The service worker of a new build carries that build's list (vite.config.ts embeds it in sw.js), so the
// "Update ready" notice can show notes this running build has never seen.

import releases from './release-notes.json'

export interface Release {
  version: string
  /** YYYY-MM-DD */
  date: string
  newFeatures: string[]
  bugFixes: string[]
}

/** What a new build's service worker reports about itself. */
export interface BuildInfo {
  /** package.json version + commit, as in System Check ("0.1.0+abc1234"). */
  version: string
  releases: Release[]
}

export const releaseNotes: Release[] = releases

/** Releases in `incoming` (a new build's notes) that `known` (this build's notes) doesn't list. */
export function newReleases(incoming: Release[], known: Release[]): Release[] {
  const seen = new Set(known.map((r) => r.version))
  return incoming.filter((r) => !seen.has(r.version))
}

/**
 * Compares two versions ("0.6.13", "0.6.13+abc1234": the part after "+" is ignored): negative when `a` is earlier,
 * positive when later, 0 when the same or when either can't be read.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())?.slice(1).map(Number) ?? null
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * What "Update ready" shows for a waiting build: its version, the releases this build doesn't list, and whether it
 * is an earlier version (the website was rolled back: docs/ROLLBACK.md). An earlier build's notes are all known here,
 * so it lists none and says it goes back instead.
 */
export function updateInfo(info: BuildInfo | null, running: string, known: Release[]): { version: string; releases: Release[]; earlier: boolean } {
  const version = info?.version ?? ''
  const earlier = !!version && compareVersions(version, running) < 0
  return { version, releases: earlier ? [] : newReleases(info?.releases ?? [], known), earlier }
}
