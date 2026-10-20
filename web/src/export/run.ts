// Runs an export: for each photo, develop it with its saved settings at full resolution, resize, convert to
// the output colour space, encode, and write it to the destination folder.
//
// GPU failures (PHASE3.md, Part 14; docs/diagnosis/EXPORT_BLANK_FILE.md): each photo's GPU work runs inside the
// engine's error scopes (`guarded`), so a rejected or failed command buffer, which reads back as zeros, fails the
// photo instead of writing a black file. A lost engine is replaced before the next photo, and a photo whose device
// was lost, ran out of memory or failed internally is tried once more on a fresh engine (never after a validation
// error, which would only fail again). A failed photo writes no file and is listed with a message for people.
//
// Overlapped (PHASE3.md, Part 22): photos are developed on the GPU one after another, as before, but encoded on a pool
// of encoder workers (encoder-pool.ts, on the page's CPU budget), so photo N encodes while photo N + 1 develops.
// Finishing a photo (its file name, conflict check and write, and the progress) happens strictly in photo order,
// after the photos before it are finished, so the files, their names, the `_01` numbering and the lists are what the
// one-at-a-time export gave. Memory is bounded: a photo is developed only while fewer than `inFlightLimit` developed
// photos wait to be encoded and written. Cancel stops developing new photos; the photos already developed are
// encoded and written.

import { getCatalog } from '../catalog/client'
import type { PhotoDetail } from '../catalog/types'
import { loadIntoEngine, multipliers, savedSettings, stageOptions } from '../develop/source'
import { buildIcc, OUTPUT_SPACES, outputTrc, rec2020ToProfile, type OutputSpace } from '../engine/color/icc'
import { displayUniforms } from '../engine/develop/settings'
import { DevelopEngine, retryableGpuError } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import { RawDecoder } from '../engine/raw/decoder'
import { getDirAt, getRootHandle, openPhotoFile } from '../platform/roots'
import { cpuBudget } from '../engine/cpu-budget'
import type { EncodeJob, EncodeResult } from './encode'
import { EncoderPool } from './encoder-pool'
import { buildExif } from './exif-writer'
import type { ChromaSubsampling } from './jpeg-encoder'
import { DEFAULT_METADATA, exportXmp, type MetadataOptions } from './metadata'
import { clampPpi, DEFAULT_OUTPUT_SHARPENING, DEFAULT_PPI, sharpenParams, type OutputSharpening } from './sharpen'
import { DEFAULT_SIZE, outputSize, type SizeSettings } from './size'
import { expandTemplate } from './template'

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
  /**
   * The same dither for 8-bit JPEGs too (PHASE3.md Part 25; owner's decision V2 = C: an Export option, off by default, so
   * no export changes unless it is ticked). Against steps in smooth vignettes and skies; the encoder benchmark measured no
   * effect of dither in JPEGs at quality 85–95 (docs/research/JPEG_ENCODER_BENCHMARK.md), so it may matter only at the
   * highest qualities.
   */
  ditherJpeg: boolean
  metadata: MetadataOptions
  /** File name template (darktable syntax), without extension. */
  template: string
  /** 'folder' = a folder the user picked; 'beside' = a subfolder next to each original. */
  destination: 'folder' | 'beside'
  /** Subfolder created inside the destination ('' = none). */
  subfolder: string
  conflict: Conflict
}

/** The export's dither amplitude (output steps): PNG/TIFF 8-bit by their option, JPEG only when its own option is ticked. */
export function exportDither(s: Pick<ExportSettings, 'format' | 'dither' | 'ditherJpeg'>, bits: 8 | 16): number {
  if (bits !== 8) return 0
  return s.format === 'jpeg' ? (s.ditherJpeg ? 1 : 0) : s.dither ? 1 : 0
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
  ditherJpeg: false,
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

/**
 * Memory a developed photo may need until it is written: its read-back pixels (4 bytes a pixel, 8 at 16 bits) and
 * the encoder's working memory (jpegli's WebAssembly heap is about 13 bytes a pixel, measured in Node at 24 and 45 MP;
 * PNG and TIFF make an RGB copy and a filtered or predicted copy, 6 bytes a pixel, 12 at 16 bits).
 */
export function photoBytes(width: number, height: number, format: ExportFormat, bits: 8 | 16): number {
  const px = width * height
  return px * (bits === 16 ? 8 : 4) + px * (format === 'jpeg' ? 13 : bits === 16 ? 12 : 6)
}

/**
 * What the developed photos waiting to be encoded and written may hold at once: 2 GiB, or a quarter of the device's
 * memory where the browser says it is less than 8 GB (`navigator.deviceMemory`, Chromium only).
 */
export function inFlightBudget(deviceMemoryGb?: number): number {
  const gib = 1024 ** 3
  return deviceMemoryGb && deviceMemoryGb < 8 ? Math.max(gib / 4, (deviceMemoryGb * gib) / 4) : 2 * gib
}

/**
 * How many developed photos may wait to be encoded and written at once: as many as fit `budget` at the largest photo
 * so far, at most one more than the encoders (all busy and one ready), at least one (then the export runs one photo
 * at a time, as before). E.g. 24 MP JPEGs: 408 MB each, 5 in 2 GiB; 45 MP JPEGs: 765 MB, 2; 45 MP 16-bit TIFFs:
 * 900 MB, 2; 100 MP 16-bit TIFFs: 2 GB, 1.
 */
export function inFlightLimit(largestPhotoBytes: number, encoders: number, budget = inFlightBudget()): number {
  if (!largestPhotoBytes) return 1
  return Math.max(1, Math.min(encoders + 1, Math.floor(budget / largestPhotoBytes)))
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
  const budget = inFlightBudget((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
  // Export is foreground work for its whole run: background passes (culling analysis) leave it the CPU budget.
  const encoders = new EncoderPool({ hold: true })
  // Developed photos not yet written, and the largest one's memory so far.
  let waiting = 0
  let largest = 0
  let freed: (() => void) | null = null
  const wake = () => {
    freed?.()
    freed = null
  }
  signal?.addEventListener('abort', wake)
  // Each photo is finished (named, written, counted) after the one before it.
  let finishing: Promise<void> = Promise.resolve()
  try {
    for (const [index, id] of ids.entries()) {
      if (signal?.aborted) break
      // Bounded memory: wait until a developed photo is written.
      while (waiting > 0 && waiting >= inFlightLimit(largest, cpuBudget.total, budget) && !signal?.aborted) await new Promise<void>((r) => (freed = r))
      if (signal?.aborted) break
      const p = await catalog.getPhoto(id)
      progress.current = p?.fileName ?? `#${id}`
      onProgress({ ...progress })
      let photo: Promise<Developed>
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
              const settings = savedSettings(saved, info.kind, info.iso)
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
                dither: exportDither(s, bits),
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
        const source = { make: p.cameraMake, model: p.cameraModel, lens: p.lens, iso: p.iso, shutter: p.shutter, aperture: p.aperture, focalLength: p.focalLength, capturedAt: p.capturedAt }
        // The export time, taken now, as when the photo was encoded right after developing it.
        const exif = s.metadata.camera ? buildExif(source, { width, height, srgb: s.space === 'srgb', dpi: ppi }) : undefined
        const xmp = exportXmp(p, saved?.settings ?? null, s.metadata, await catalog.photoKeywords(id), await catalog.photoMetadata(id))
        let job: EncodeJob
        if (s.format === 'jpeg') {
          job = { format: 'jpeg', rgba: out.rgba as Uint8ClampedArray, width, height, quality: s.quality, subsampling: s.jpegChroma, maxBytes: Math.round(s.limitKb * 1024), exif, xmp, icc }
        } else if (s.format === 'png') {
          job = { format: 'png', rgba: out.rgba, width, height, icc: { name: space.profile.name, data: icc }, cicp: space.cicp, exif, xmp, dpi: ppi }
        } else {
          job = {
            format: 'tiff',
            rgba: out.rgba,
            width,
            height,
            compression: s.tiffCompression,
            icc,
            xmp,
            exif: s.metadata.camera ? { source, options: { width, height, srgb: s.space === 'srgb', dpi: ppi, now: new Date() } } : undefined,
          }
        }
        largest = Math.max(largest, photoBytes(width, height, s.format, bits))
        waiting++
        const encoded = encoders.encode(job)
        // Settled when it is written or failed, so a rejection is never left unhandled meanwhile.
        encoded.catch(() => {})
        photo = Promise.resolve({ p, width, height, encoded })
      } catch (e) {
        photo = Promise.reject(e)
        photo.catch(() => {})
      }
      finishing = finishing.then(() => finish(p, id, index, photo))
    }
    await finishing
  } finally {
    signal?.removeEventListener('abort', wake)
    engine.destroy()
    decoder.dispose()
    encoders.dispose()
  }
  progress.current = ''
  onProgress({ ...progress })
  return progress

  /** The photo's file: named and written after the photos before it (so names and numbering are as one at a time). */
  async function finish(p: PhotoDetail | null, id: number, index: number, photo: Promise<Developed>) {
    try {
      const d = await photo
      const { width, height } = d
      try {
        const { blob } = await d.encoded
        const path = expandTemplate(s.template, {
          fileName: d.p.fileName, folder: d.p.folderPath, sequence: index + 1, capturedAt: d.p.capturedAt, make: d.p.cameraMake, model: d.p.cameraModel,
          lens: d.p.lens, iso: d.p.iso, aperture: d.p.aperture, shutter: d.p.shutter, focalLength: d.p.focalLength, rating: d.p.rating, color: d.p.color, width, height,
          version: d.p.version, versionName: d.p.versionName, versionCount: await catalog.versionCount(id),
        })
        const parts = path.split('/')
        const base = parts.pop()!
        let dir = await destinationDir(d.p, s, folder)
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
      } finally {
        waiting--
        wake()
      }
    } catch (e) {
      progress.failed.push({ name: p?.fileName ?? `#${id}`, error: e instanceof Error ? e.message : String(e) })
    }
    progress.done++
    onProgress({ ...progress })
  }
}

/** A developed photo on its way to its file. */
interface Developed {
  p: PhotoDetail
  width: number
  height: number
  encoded: Promise<EncodeResult>
}
