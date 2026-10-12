// Runs an export: for each photo, develop it with its saved settings at full resolution, resize, convert to
// the output colour space, encode, and write it to the destination folder.

import { getCatalog } from '../catalog/client'
import type { PhotoDetail } from '../catalog/types'
import { loadIntoEngine, multipliers, savedSettings, stageOptions } from '../develop/source'
import { buildIcc, OUTPUT_SPACES, outputTrc, rec2020ToProfile, type OutputSpace } from '../engine/color/icc'
import { displayUniforms } from '../engine/develop/settings'
import { DevelopEngine } from '../engine/gpu/develop-engine'
import { RawDecoder } from '../engine/raw/decoder'
import { getDirAt, getRootHandle, openPhotoFile } from '../platform/roots'
import { buildExif } from './exif-writer'
import { encodeJpeg, type ChromaSubsampling } from './jpeg-encoder'
import { DEFAULT_METADATA, exportXmp, type MetadataOptions } from './metadata'
import { encodePng } from './png'
import { DEFAULT_SIZE, outputSize, type SizeSettings } from './size'
import { expandTemplate } from './template'
import { encodeTiff } from './tiff'

export type ExportFormat = 'jpeg' | 'png' | 'tiff'
export type Conflict = 'unique' | 'overwrite' | 'skip'

export interface ExportSettings {
  format: ExportFormat
  /** JPEG quality 1–100 (jpegli; 90 by the benchmark). */
  quality: number
  /** JPEG chroma subsampling ('auto': 4:4:4 at quality ≥ 80, else 4:2:0). */
  jpegChroma: ChromaSubsampling
  /** JPEG file size limit in KB (0 = none). */
  limitKb: number
  /** PNG / TIFF bit depth. */
  bits: 8 | 16
  tiffCompression: 'deflate' | 'none'
  space: OutputSpace
  size: SizeSettings
  /**
   * Triangular dither of ±1 output step before rounding, for 8-bit PNG/TIFF (the benchmark measured it
   * removing banding there; it had no effect in JPEGs, so JPEGs are never dithered).
   */
  dither: boolean
  metadata: MetadataOptions
  /** File name template (darktable syntax), without extension. */
  template: string
  /** 'folder' = a folder the user picked; 'beside' = a subfolder next to each original. */
  destination: 'folder' | 'beside'
  /** Subfolder created inside the destination ('' = none). */
  subfolder: string
  conflict: Conflict
}

/**
 * Defaults: darktable's where it has one (sRGB, unique file names, metadata on); JPEG quality, chroma and
 * dithering from the encoder benchmark (docs/research/JPEG_ENCODER_BENCHMARK.md).
 */
export const DEFAULT_EXPORT: ExportSettings = {
  format: 'jpeg',
  quality: 90,
  jpegChroma: 'auto',
  limitKb: 0,
  bits: 8,
  tiffCompression: 'deflate',
  space: 'srgb',
  size: DEFAULT_SIZE,
  dither: true,
  metadata: DEFAULT_METADATA,
  template: '$(FILE.NAME)',
  destination: 'folder',
  subfolder: '',
  conflict: 'unique',
}

export interface ExportProgress {
  done: number
  total: number
  current: string
  written: string[]
  skipped: string[]
  failed: { name: string; error: string }[]
}

const EXTENSIONS: Record<ExportFormat, string> = { jpeg: 'jpg', png: 'png', tiff: 'tif' }

/** Strips alpha from RGBA output. */
function toRgb(rgba: Uint8ClampedArray | Uint16Array): Uint8Array | Uint16Array {
  const n = rgba.length / 4
  const out = rgba instanceof Uint16Array ? new Uint16Array(n * 3) : new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    out[3 * i] = rgba[4 * i]
    out[3 * i + 1] = rgba[4 * i + 1]
    out[3 * i + 2] = rgba[4 * i + 2]
  }
  return out
}

async function exists(dir: FileSystemDirectoryHandle, name: string) {
  return dir.getFileHandle(name).then(() => true, () => false)
}

/** Picks the output file name according to the conflict rule; null means skip. darktable's unique names add _01, _02… */
async function resolveName(dir: FileSystemDirectoryHandle, base: string, ext: string, conflict: Conflict): Promise<string | null> {
  const first = `${base}.${ext}`
  if (!(await exists(dir, first)) || conflict === 'overwrite') return first
  if (conflict === 'skip') return null
  for (let n = 1; n < 10000; n++) {
    const name = `${base}_${String(n).padStart(2, '0')}.${ext}`
    if (!(await exists(dir, name))) return name
  }
  throw new Error(`Too many files named ${first}`)
}

async function destinationDir(p: PhotoDetail, s: ExportSettings, folder: FileSystemDirectoryHandle | undefined): Promise<FileSystemDirectoryHandle> {
  let dir: FileSystemDirectoryHandle
  if (s.destination === 'folder') {
    if (!folder) throw new Error('Choose a destination folder first')
    dir = folder
  } else {
    const root = await getRootHandle(p.rootId)
    if (!root) throw new Error('The photo’s library folder is not connected')
    dir = await getDirAt(root, p.folderPath)
  }
  return s.subfolder.trim() ? getDirAt(dir, s.subfolder.trim(), true) : dir
}

export async function runExport(
  ids: number[],
  s: ExportSettings,
  folder: FileSystemDirectoryHandle | undefined,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportProgress> {
  const catalog = getCatalog()
  const progress: ExportProgress = { done: 0, total: ids.length, current: '', written: [], skipped: [], failed: [] }
  const decoder = new RawDecoder()
  const engine = await DevelopEngine.create('readback')
  const space = OUTPUT_SPACES[s.space]
  const icc = buildIcc(space.profile)
  try {
    for (const [index, id] of ids.entries()) {
      if (signal?.aborted) break
      const p = await catalog.getPhoto(id)
      progress.current = p?.fileName ?? `#${id}`
      onProgress({ ...progress })
      try {
        if (!p) throw new Error('Photo not found in the library')
        const file = await openPhotoFile(p.rootId, p.folderPath, p.fileName)
        if (!file) throw new Error('The photo’s folder isn’t connected. Reconnect it in the Library.')
        const decoded = await decoder.decode(file, true)
        const info = loadIntoEngine(engine, decoded)
        const saved = await catalog.getEdit(id)
        const settings = savedSettings(saved, info.kind)
        await engine.process(stageOptions(settings, info))
        // The crop at 100 % (the whole photo when it isn't cropped).
        const [iw, ih] = engine.outputSize(settings.geometry)
        const { width, height } = outputSize(iw, ih, s.size)
        const bits = s.format === 'jpeg' ? 8 : s.bits
        const out = await engine.renderOutput(displayUniforms(settings), multipliers(settings, info), {
          width,
          height,
          toOutput: rec2020ToProfile(space.profile),
          trc: outputTrc(space.profile),
          bits,
          dither: s.dither && s.format !== 'jpeg' && bits === 8 ? 1 : 0,
        })

        const exif = s.metadata.camera
          ? buildExif(
              { make: p.cameraMake, model: p.cameraModel, lens: p.lens, iso: p.iso, shutter: p.shutter, aperture: p.aperture, focalLength: p.focalLength, capturedAt: p.capturedAt },
              { width, height, srgb: s.space === 'srgb' },
            )
          : undefined
        const xmp = exportXmp(p, saved?.settings ?? null, s.metadata, await catalog.photoKeywords(id), await catalog.photoMetadata(id))

        let blob: Blob
        if (s.format === 'jpeg') {
          blob = (await encodeJpeg(out.rgba as Uint8ClampedArray<ArrayBuffer>, width, height, {
            quality: s.quality, subsampling: s.jpegChroma, maxBytes: Math.round(s.limitKb * 1024), exif, xmp, icc,
          })).blob
        } else if (s.format === 'png') {
          blob = await encodePng({ width, height, pixels: toRgb(out.rgba), icc: { name: space.profile.name, data: icc }, cicp: space.cicp, exif, xmp, dpi: 300 })
        } else {
          blob = await encodeTiff({
            width,
            height,
            pixels: toRgb(out.rgba),
            compression: s.tiffCompression,
            icc,
            xmp,
            exif: s.metadata.camera
              ? { source: { make: p.cameraMake, model: p.cameraModel, lens: p.lens, iso: p.iso, shutter: p.shutter, aperture: p.aperture, focalLength: p.focalLength, capturedAt: p.capturedAt }, options: { width, height, srgb: s.space === 'srgb' } }
              : undefined,
          })
        }

        const path = expandTemplate(s.template, {
          fileName: p.fileName, folder: p.folderPath, sequence: index + 1, capturedAt: p.capturedAt, make: p.cameraMake, model: p.cameraModel,
          lens: p.lens, iso: p.iso, aperture: p.aperture, shutter: p.shutter, focalLength: p.focalLength, rating: p.rating, color: p.color, width, height,
          version: p.version, versionName: p.versionName, versionCount: await catalog.versionCount(id),
        })
        const parts = path.split('/')
        const base = parts.pop()!
        let dir = await destinationDir(p, s, folder)
        if (parts.length) dir = await getDirAt(dir, parts.join('/'), true)
        const name = await resolveName(dir, base, EXTENSIONS[s.format], s.conflict)
        if (!name) {
          progress.skipped.push(`${base}.${EXTENSIONS[s.format]}`)
        } else {
          const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
          await w.write(blob)
          await w.close()
          progress.written.push([...parts, name].join('/'))
        }
      } catch (e) {
        progress.failed.push({ name: p?.fileName ?? `#${id}`, error: e instanceof Error ? e.message : String(e) })
      }
      progress.done++
      onProgress({ ...progress })
    }
  } finally {
    engine.destroy()
    decoder.dispose()
  }
  progress.current = ''
  onProgress({ ...progress })
  return progress
}
