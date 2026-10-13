// Runs an export: for each photo, develop it with its saved settings at full resolution, resize, convert to
// the output colour space, encode, and write it to the destination folder.
//
// GPU failures (PHASE3.md, Part 14; docs/diagnosis/EXPORT_BLANK_FILE.md): each photo's GPU work runs inside the
// engine's error scopes (`guarded`), so a rejected or failed command buffer, which reads back as zeros, fails the
// photo instead of writing a black file. A lost engine is replaced before the next photo, and a photo whose device
// was lost, ran out of memory or failed internally is tried once more on a fresh engine (never after a validation
// error, which would only fail again). A failed photo writes no file and is listed with a message for people.

import { getCatalog } from '../catalog/client'
import type { PhotoDetail } from '../catalog/types'
import { loadIntoEngine, multipliers, savedSettings, stageOptions } from '../develop/source'
import { buildIcc, OUTPUT_SPACES, outputTrc, rec2020ToProfile, type OutputSpace } from '../engine/color/icc'
import { displayUniforms } from '../engine/develop/settings'
import { DevelopEngine, retryableGpuError } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import { RawDecoder } from '../engine/raw/decoder'
import { getDirAt, getRootHandle, openPhotoFile } from '../platform/roots'
import { buildExif } from './exif-writer'
import { encodeJpeg, type ChromaSubsampling } from './jpeg-encoder'
import { DEFAULT_METADATA, exportXmp, type MetadataOptions } from './metadata'
import { encodePng } from './png'
import { clampPpi, DEFAULT_OUTPUT_SHARPENING, DEFAULT_PPI, sharpenParams, type OutputSharpening } from './sharpen'
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
  /** Resolution in pixels per inch, written into the file and used to size print sharpening. */
  ppi: number
  /** Output sharpening (export only; the edit and Develop are unchanged). */
  sharpen: OutputSharpening
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
  ppi: DEFAULT_PPI,
  sharpen: DEFAULT_OUTPUT_SHARPENING,
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

/** An export started by the user waits at most this long for Develop's drawing between photos (engine/gpu/gate.ts). */
const EXPORT_MAX_WAIT = 1000

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
  // Private to this export, so its device's error scopes see only its own work (DevelopEngine.guarded).
  let engine = await DevelopEngine.create('readback')
  const freshEngine = async () => {
    engine.destroy()
    engine = await DevelopEngine.create('readback')
  }
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
        const saved = await catalog.getEdit(id)
        const ppi = clampPpi(s.ppi ?? DEFAULT_PPI)
        const bits = s.format === 'jpeg' ? 8 : s.bits
        // All of the photo's GPU work, checked for GPU errors; the photo is unloaded afterwards to free its memory.
        const develop = async () => {
          await gpuGate.background(EXPORT_MAX_WAIT)
          const e = engine
          try {
            return await e.guarded(async () => {
              const info = loadIntoEngine(e, decoded)
              const settings = savedSettings(saved, info.kind)
              await e.process(stageOptions(settings, info))
              // The crop at 100 % (the whole photo when it isn't cropped).
              const [iw, ih] = e.outputSize(settings.geometry)
              const { width, height } = outputSize(iw, ih, s.size)
              return e.renderOutput(displayUniforms(settings), multipliers(settings, info), {
                width,
                height,
                toOutput: rec2020ToProfile(space.profile),
                trc: outputTrc(space.profile),
                bits,
                dither: s.dither && s.format !== 'jpeg' && bits === 8 ? 1 : 0,
                // The scale actually used (floor rounding included), so screen sharpening follows the pixel size.
                sharpen: sharpenParams(s.sharpen, Math.min(width / iw, height / ih), ppi),
              })
            })
          } finally {
            if (!e.isLost) e.unload()
          }
        }
        // A device lost on an earlier photo would fail this one too.
        if (engine.isLost) await freshEngine()
        const out = await develop().catch(async (e: unknown) => {
          if (!retryableGpuError(e)) throw e
          console.warn('Export: trying the photo again on a new graphics device:', e)
          await freshEngine()
          return develop()
        })
        const { width, height } = out

        const exif = s.metadata.camera
          ? buildExif(
              { make: p.cameraMake, model: p.cameraModel, lens: p.lens, iso: p.iso, shutter: p.shutter, aperture: p.aperture, focalLength: p.focalLength, capturedAt: p.capturedAt },
              { width, height, srgb: s.space === 'srgb', dpi: ppi },
            )
          : undefined
        const xmp = exportXmp(p, saved?.settings ?? null, s.metadata, await catalog.photoKeywords(id), await catalog.photoMetadata(id))

        let blob: Blob
        if (s.format === 'jpeg') {
          blob = (await encodeJpeg(out.rgba as Uint8ClampedArray<ArrayBuffer>, width, height, {
            quality: s.quality, subsampling: s.jpegChroma, maxBytes: Math.round(s.limitKb * 1024), exif, xmp, icc,
          })).blob
        } else if (s.format === 'png') {
          blob = await encodePng({ width, height, pixels: toRgb(out.rgba), icc: { name: space.profile.name, data: icc }, cicp: space.cicp, exif, xmp, dpi: ppi })
        } else {
          blob = await encodeTiff({
            width,
            height,
            pixels: toRgb(out.rgba),
            compression: s.tiffCompression,
            icc,
            xmp,
            exif: s.metadata.camera
              ? { source: { make: p.cameraMake, model: p.cameraModel, lens: p.lens, iso: p.iso, shutter: p.shutter, aperture: p.aperture, focalLength: p.focalLength, capturedAt: p.capturedAt }, options: { width, height, srgb: s.space === 'srgb', dpi: ppi } }
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
