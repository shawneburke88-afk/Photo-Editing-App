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
