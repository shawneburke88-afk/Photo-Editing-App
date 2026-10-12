import { describe, expect, it } from 'vitest'
import { RAW_EXTENSIONS } from '../engine/raw/decoder'
import manifestText from '../../public/manifest.webmanifest?raw'
import packageText from '../../package.json?raw'
import { isLaunchablePhoto, launched, receiveLaunch } from './launch'
import { newReleases, releaseNotes, type Release } from './notes'

const manifest = JSON.parse(manifestText)
const publicFiles = Object.keys(import.meta.glob('../../public/**/*')).map((p) => p.replace('../../public/', ''))

describe('release notes', () => {
  it('lists this version first (a release bumps package.json and adds notes)', () => {
    expect(releaseNotes[0].version).toBe(JSON.parse(packageText).version)
  })

  it('has unique versions, dates, and the two groups the release rules ask for', () => {
    expect(new Set(releaseNotes.map((r) => r.version)).size).toBe(releaseNotes.length)
    for (const r of releaseNotes) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Array.isArray(r.newFeatures) && Array.isArray(r.bugFixes)).toBe(true)
      expect(r.newFeatures.length + r.bugFixes.length).toBeGreaterThan(0)
    }
  })

  it('shows only the releases the running build does not know', () => {
    const r = (version: string): Release => ({ version, date: '2026-01-01', newFeatures: ['x'], bugFixes: [] })
    expect(newReleases([r('0.3.0'), r('0.2.0'), r('0.1.0')], [r('0.1.0')]).map((x) => x.version)).toEqual(['0.3.0', '0.2.0'])
    expect(newReleases([r('0.1.0')], [r('0.1.0')])).toEqual([])
  })
})

describe('web app manifest', () => {
  it('uses paths relative to itself, so it works under the GitHub Pages base path', () => {
    for (const url of [manifest.start_url, manifest.scope, manifest.id, ...manifest.icons.map((i: { src: string }) => i.src)]) {
      expect(url.startsWith('/') || url.includes('://')).toBe(false)
    }
  })

  it('has icons that exist, including 192, 512 and maskable', () => {
    for (const icon of manifest.icons) expect(publicFiles).toContain(icon.src)
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  })

  it('opens every RAW type the decoder reads, plus JPEG', () => {
    const accept: Record<string, string[]> = manifest.file_handlers[0].accept
    const extensions = Object.values(accept).flat().sort()
    expect(extensions).toEqual([...RAW_EXTENSIONS.map((e) => `.${e}`), '.jpg', '.jpeg'].sort())
  })
})

describe('Open with LightBench', () => {
  const file = (name: string) => ({ kind: 'file', name }) as FileSystemFileHandle

  it('accepts RAW and JPEG names only', () => {
    expect(isLaunchablePhoto('DSC_0001.NEF')).toBe(true)
    expect(isLaunchablePhoto('a.jpeg')).toBe(true)
    expect(isLaunchablePhoto('a.JPG')).toBe(true)
    expect(isLaunchablePhoto('a.png')).toBe(false)
    expect(isLaunchablePhoto('a.xmp')).toBe(false)
  })

  it('keeps launched photos for the Library and ignores other files and folders', () => {
    let calls = 0
    const stop = launched.subscribe(() => calls++)
    receiveLaunch({ files: [file('notes.txt'), { kind: 'directory', name: 'x.nef' } as FileSystemHandle] })
    expect(launched.get()).toEqual([])
    receiveLaunch({ files: [file('A.ARW'), file('readme.txt'), file('B.jpg')] })
    expect(launched.get().map((f) => f.name)).toEqual(['A.ARW', 'B.jpg'])
    launched.clear()
    expect(launched.get()).toEqual([])
    expect(calls).toBe(2)
    stop()
  })
})
