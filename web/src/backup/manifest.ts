// What a library backup holds and how it is checked. The format is LightBench's own: a ZIP file with the catalog,
// the thumbnails, the settings and a manifest listing every file with its size and SHA-256.

export const FORMAT = 'lightbench-library-backup'
/** Bumped when a backup's layout changes in a way older versions can't read. */
export const FORMAT_VERSION = 1

export const MANIFEST = 'manifest.json'
export const CATALOG = 'catalog.sqlite3'
export const SETTINGS = 'settings.json'
export const README = 'README.txt'
export const THUMBS = 'thumbnails/'
/** Where a backup is written before it is downloaded, when the browser has no save dialog (top of OPFS). */
export const DOWNLOAD_COPY = '.lightbench-backup-download.zip'

export const NEWER_BACKUP_MESSAGE =
  'This backup was made by a newer version of LightBench. Reload to get the latest version, then try again. Nothing in the library was changed.'

export interface BackupFile {
  path: string
  size: number
  sha256: string
}

export interface BackupCounts {
  photos: number
  thumbnails: number
  folders: number
  collections: number
  keywords: number
  edits: number
  presets: number
  settings: number
}

export interface Manifest {
  format: typeof FORMAT
  formatVersion: number
  appVersion: string
  /** The catalog's schema version (SQLite user_version). */
  schemaVersion: number
  /** ISO 8601, UTC. */
  createdAt: string
  counts: BackupCounts
  files: BackupFile[]
}

export interface SettingsFile {
  localStorage: Record<string, string>
}

/**
 * LightBench's settings in localStorage: keys starting `lightbench.`, `library:` or `cull:` (LightBench's choice:
 * these are the prefixes LightBench's own keys use). Others, such as notices hidden in this browser, are left out.
 */
export const isSettingKey = (key: string) => key.startsWith('lightbench.') || key.startsWith('library:') || key.startsWith('cull:')

export function pickSettings(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): SettingsFile {
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key === null || !isSettingKey(key)) continue
    const value = storage.getItem(key)
    if (value !== null) out[key] = value
  }
  return { localStorage: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) }
}

/** Replaces LightBench's settings with a backup's (removing ones the backup doesn't have). */
export function applySettings(storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>, settings: SettingsFile) {
  const current: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null && isSettingKey(key)) current.push(key)
  }
  for (const key of current) if (!(key in settings.localStorage)) storage.removeItem(key)
  for (const [key, value] of Object.entries(settings.localStorage)) if (isSettingKey(key)) storage.setItem(key, value)
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

const NOT_A_BACKUP = 'This file is not a LightBench library backup.'
const damaged = (why: string) => new Error(`This backup is damaged (${why}). Nothing in the library was changed.`)

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * Checks a manifest's structure and that this version can restore it. Throws with a message for the user.
 * `schemaVersion` is the newest catalog schema this version of LightBench knows.
 */
export function parseManifest(text: string, schemaVersion: number): Manifest {
  let m: Partial<Manifest> & Record<string, unknown>
  try {
    m = JSON.parse(text)
  } catch {
    throw new Error(NOT_A_BACKUP)
  }
  if (!m || typeof m !== 'object' || m.format !== FORMAT) throw new Error(NOT_A_BACKUP)
  if (!isCount(m.formatVersion) || m.formatVersion < 1) throw damaged('unknown format version')
  if (m.formatVersion > FORMAT_VERSION) throw new Error(NEWER_BACKUP_MESSAGE)
  if (!isCount(m.schemaVersion) || m.schemaVersion < 1) throw damaged('no library version')
  if (m.schemaVersion > schemaVersion) throw new Error(NEWER_BACKUP_MESSAGE)
  if (typeof m.appVersion !== 'string' || typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) throw damaged('bad header')
  const c = m.counts as Partial<BackupCounts> | undefined
  const keys: (keyof BackupCounts)[] = ['photos', 'thumbnails', 'folders', 'collections', 'keywords', 'edits', 'presets', 'settings']
  if (!c || !keys.every((k) => isCount(c[k]))) throw damaged('bad counts')
  if (!Array.isArray(m.files)) throw damaged('no file list')
  const seen = new Set<string>()
  for (const f of m.files as Partial<BackupFile>[]) {
    if (!f || typeof f.path !== 'string' || !isCount(f.size) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw damaged('bad file list')
    if (seen.has(f.path)) throw damaged(`${f.path} is listed twice`)
    seen.add(f.path)
    const known = f.path === CATALOG || f.path === SETTINGS || f.path === README || /^thumbnails\/\d+\.jpg$/.test(f.path)
    if (!known) throw damaged(`unexpected file ${f.path}`)
  }
  if (!seen.has(CATALOG)) throw damaged('no catalog')
  if (!seen.has(SETTINGS)) throw damaged('no settings')
  if (m.files.filter((f) => f.path.startsWith(THUMBS)).length !== c.thumbnails) throw damaged('thumbnail count')
  return m as Manifest
}

/** Checks that every file the manifest lists is in the archive with the listed size, and nothing else is. */
export function checkListing(manifest: Manifest, archive: { name: string; size: number }[]) {
  const listed = new Map(manifest.files.map((f) => [f.path, f]))
  const names = new Set<string>()
  for (const e of archive) {
    if (e.name === MANIFEST) continue
    if (names.has(e.name)) throw damaged(`${e.name} is in it twice`)
    names.add(e.name)
    const f = listed.get(e.name)
    if (!f) throw damaged(`unexpected file ${e.name}`)
    if (f.size !== e.size) throw damaged(`${e.name} has the wrong size`)
  }
  for (const f of manifest.files) if (!names.has(f.path)) throw damaged(`${f.path} is missing`)
}

/** Throws when a file's contents don't match the manifest. */
export async function checkFile(file: BackupFile, data: Uint8Array<ArrayBuffer>) {
  if (data.length !== file.size || (await sha256(data)) !== file.sha256) throw damaged(`${file.path} doesn't match its checksum`)
}

/** The SQLite header (https://sqlite.org/fileformat2.html#the_database_header): magic string and user version. */
export function catalogHeader(data: Uint8Array): { ok: boolean; userVersion: number } {
  const magic = 'SQLite format 3\0'
  if (data.length < 100) return { ok: false, userVersion: 0 }
  for (let i = 0; i < magic.length; i++) if (data[i] !== magic.charCodeAt(i)) return { ok: false, userVersion: 0 }
  return { ok: true, userVersion: new DataView(data.buffer, data.byteOffset, 100).getUint32(60) }
}

export function readmeText(m: Pick<Manifest, 'createdAt' | 'appVersion' | 'counts'>): string {
  return [
    'LightBench library backup',
    '',
    `Made ${m.createdAt} by LightBench ${m.appVersion}: ${m.counts.photos} photos.`,
    'To restore it, open LightBench and choose Restore… at the bottom of the Library\'s left panel.',
    '',
    'It holds the catalog (ratings, keywords, collections, edits, presets…), the thumbnails and LightBench\'s settings.',
    'It does not hold your photos or their sidecar (.xmp) files: they stay in your folders.',
    'manifest.json lists every file with its SHA-256 checksum.',
    '',
  ].join('\r\n')
}
