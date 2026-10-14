// Lightroom's masks in XMP sidecars, read best-effort and labelled experimental (docs/PHASE3.md Part 23; owner's decision
// 8: read them, never write them; LightBench's own masks go in `lightbench:Develop`).
//
// What is known and what isn't (docs/research/MASKING.md "Lightroom mapping"; cowork-2026-10-13b/B_MASKING.md item 4):
//  - The FIELD NAMES are confirmed from ExifTool's XMP.pm 3.79 (a secondary source, but generated from observed files):
//    crs:MaskGroupBasedCorrections (a Seq of Correction structs: What, CorrectionAmount, CorrectionActive, CorrectionName,
//    the Local* sliders, CorrectionRangeMask, CorrectionMasks), CorrectionMasks (a Seq of CorrectionMask: What,
//    MaskBlendMode, MaskInverted, MaskValue, Radius, Flow, CenterWeight, Dabs, ZeroX/Y, FullX/Y, Top, Left, Bottom,
//    Right, Angle, Feather, Flipped, …) and CorrectionRangeMask (Type, LumRange, …).
//  - Their MEANINGS are not confirmed anywhere: no Lightroom-written sidecar with masks was available. Every decoding
//    below is a GUESS taken from LightCraft's reader (crates/engine/src/crs_masks.rs, "implemented from the public XMP data
//    model and black-box observation; best effort") and is marked so: the `What` values, MaskBlendMode 0/1/2 = add,
//    subtract, intersect, the Local* scales (fractions −1…1; LocalExposure2012 a fraction of 4 EV), CorrectionAmount as a
//    fraction (1 = 100 %), the Dabs strings ("d x y"), Radius, Flow and CenterWeight, the circular gradient's box and
//    angle, LumRange as four fractions, and the coordinate frame (taken as fractions of the photo as stored, the frame
//    Lightroom's crop edges use (sidecar/lightroom.ts), which is LightBench's sensor frame).
//  - Skipped, and said so: AI masks (Mask/Image: the raster isn't in the XMP), colour range masks (their samples'
//    encoding isn't known), depth ranges, a range mask attached to a whole correction (Lightroom's way of limiting a
//    brush or gradient to a range: LightBench's range masks apply to the whole photo, owner's decision 12), inactive
//    corrections, and anything this reader doesn't recognise. Masks Lightroom keeps in its `.acr` file can't be read at
//    all (sidecar/acr.ts).

import { NS_CRS } from './lightroom'
import { MAX_DABS, normalizeMasks, type LocalAdjust, type LocalMask, type MaskComponent, type MaskOp, type KnownShape } from '../engine/develop/masks'

const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

/** A struct or a value as XMP has it: text, a list, or fields. */
export type XmpValue = string | XmpValue[] | { [k: string]: XmpValue }

/** Reads an XMP struct element (fields as attributes, child elements, an rdf:Description, or rdf:parseType="Resource"). */
function readStruct(el: Element): { [k: string]: XmpValue } {
  const out: { [k: string]: XmpValue } = {}
  const take = (e: Element) => {
    for (const a of Array.from(e.attributes)) if (a.namespaceURI === NS_CRS) out[a.localName] = a.value
    for (const c of Array.from(e.children)) {
      if (c.namespaceURI === NS_RDF && c.localName === 'Description') take(c)
      else if (c.namespaceURI === NS_CRS) out[c.localName] = readValue(c)
    }
  }
  take(el)
  return out
}

function readValue(el: Element): XmpValue {
  const list = Array.from(el.children).find((c) => c.namespaceURI === NS_RDF && (c.localName === 'Seq' || c.localName === 'Bag' || c.localName === 'Alt'))
  if (list) return Array.from(list.children).filter((li) => li.localName === 'li').map((li) => (isStruct(li) ? readStruct(li) : (li.textContent ?? '').trim()))
  if (isStruct(el)) return readStruct(el)
  return (el.textContent ?? '').trim()
}

const isStruct = (el: Element) =>
  el.getAttributeNS(NS_RDF, 'parseType') === 'Resource' ||
  Array.from(el.attributes).some((a) => a.namespaceURI === NS_CRS) ||
  Array.from(el.children).some((c) => c.namespaceURI === NS_CRS || (c.namespaceURI === NS_RDF && c.localName === 'Description'))

/** crs:MaskGroupBasedCorrections as plain structs, or undefined when the sidecar has none. */
export function parseLrMasks(doc: Document): { [k: string]: XmpValue }[] | undefined {
  for (const d of Array.from(doc.getElementsByTagNameNS(NS_RDF, 'Description'))) {
    for (const c of Array.from(d.children)) {
      if (c.namespaceURI !== NS_CRS || c.localName !== 'MaskGroupBasedCorrections') continue
      const v = readValue(c)
      return Array.isArray(v) ? v.filter((x): x is { [k: string]: XmpValue } => !!x && typeof x === 'object' && !Array.isArray(x)) : []
    }
  }
  return undefined
}

const num = (v: XmpValue | undefined): number | undefined => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
const bool = (v: XmpValue | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : undefined)
const list = (v: XmpValue | undefined): XmpValue[] => (Array.isArray(v) ? v : [])
const struct = (v: XmpValue | undefined): { [k: string]: XmpValue } | null => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** The Local* fields and their LightBench sliders (GUESS: fractions −1…1 → ×100; exposure × 4 EV, after LightCraft). */
const LOCAL_FIELDS: [string, keyof LocalAdjust, number][] = [
  ['LocalExposure2012', 'exposure', 4],
  ['LocalContrast2012', 'contrast', 100],
  ['LocalHighlights2012', 'highlights', 100],
  ['LocalShadows2012', 'shadows', 100],
  ['LocalWhites2012', 'whites', 100],
  ['LocalBlacks2012', 'blacks', 100],
  ['LocalSaturation', 'saturation', 100],
  ['LocalTemperature', 'temperature', 100],
  ['LocalTint', 'tint', 100],
]
/** Local sliders LightBench doesn't have yet: their presence is reported. */
const LATER_FIELDS = ['LocalTexture', 'LocalClarity2012', 'LocalDehaze', 'LocalSharpness', 'LocalLuminanceNoise', 'LocalMoire', 'LocalDefringe', 'LocalHue', 'LocalToningHue', 'LocalToningSaturation']

/** GUESS (LightCraft): MaskBlendMode 0 add, 1 subtract, 2 intersect. ExifTool doesn't decode it. */
const BLEND: Record<number, MaskOp> = { 0: 'add', 1: 'subtract', 2: 'intersect' }

export interface LrMasksRead {
  masks: LocalMask[]
  /** What was left out or approximated, in words. */
  notes: string[]
}

/**
 * Lightroom's corrections → LightBench masks (experimental). `stored` is the photo's size as stored (the sensor's, for a
 * RAW), for radii and brush sizes; the mask ids start with "lr" so the panel can say where they came from.
 */
export function masksFromLightroom(corrections: { [k: string]: XmpValue }[], stored: [number, number]): LrMasksRead {
  const notes = new Set<string>()
  const out: unknown[] = []
  const [W, H] = stored
  const short = Math.min(W, H)
  corrections.forEach((c, i) => {
    if (bool(c.CorrectionActive) === false) return notes.add('Inactive Lightroom masks were left out.')
    const name = typeof c.CorrectionName === 'string' && c.CorrectionName ? c.CorrectionName : `Lightroom mask ${i + 1}`
    if (struct(c.CorrectionRangeMask)) notes.add(`${name}: its range limit was left out (range masks apply to the whole photo in LightBench).`)
    const adjust: LocalAdjust = {}
    for (const [field, key, scale] of LOCAL_FIELDS) {
      const v = num(c[field])
      if (v !== undefined && v !== 0) adjust[key] = Math.round(v * scale * 100) / 100
    }
    if (LATER_FIELDS.some((f) => (num(c[f]) ?? 0) !== 0)) notes.add(`${name}: sliders LightBench doesn’t have in masks yet (Texture, Clarity, Dehaze, …) were left out.`)
    const components: MaskComponent[] = []
    let dabs = 0
    list(c.CorrectionMasks).forEach((mv, k) => {
      const m = struct(mv)
      if (!m) return
      const what = typeof m.What === 'string' ? m.What : ''
      const op = BLEND[num(m.MaskBlendMode) ?? 0] ?? 'add'
      const invert = bool(m.MaskInverted) === true
      let shape: KnownShape | null = null
      if (what === 'Mask/Gradient') {
        const [fx, fy, zx, zy] = [num(m.FullX), num(m.FullY), num(m.ZeroX), num(m.ZeroY)]
        if (fx !== undefined && fy !== undefined && zx !== undefined && zy !== undefined) shape = { kind: 'linear', full: [fx, fy], zero: [zx, zy] }
      } else if (what === 'Mask/CircularGradient') {
        const [t, l, b, r] = [num(m.Top), num(m.Left), num(m.Bottom), num(m.Right)]
        if (t !== undefined && l !== undefined && b !== undefined && r !== undefined) {
          // GUESS: the ellipse's box in fractions of the stored photo, Angle in degrees, Feather 0–100, Flipped = inverted.
          shape = { kind: 'radial', center: [(l + r) / 2, (t + b) / 2], rx: (Math.abs(r - l) / 2) * W / short, ry: (Math.abs(b - t) / 2) * H / short, angle: num(m.Angle) ?? 0, feather: num(m.Feather) ?? 50 }
          if (bool(m.Flipped)) notes.add(`${name}: a radial gradient marked Flipped was read as inverted (a guess).`)
        }
      } else if (what === 'Mask/Paint') {
        // GUESS (LightCraft): dabs "d x y" in fractions, Radius a fraction of the photo's size, Flow 0–1, CenterWeight
        // the hard core (1 − feather), MaskValue ≤ 0 erases.
        const pts: number[] = []
        for (const d of list(m.Dabs)) {
          if (typeof d !== 'string') continue
          const parts = d.trim().split(/\s+/)
          const x = Number(parts[parts.length - 2])
          const y = Number(parts[parts.length - 1])
          if (Number.isFinite(x) && Number.isFinite(y) && dabs < MAX_DABS) {
            pts.push(x, y)
            dabs++
          }
        }
        if (pts.length) {
          const radius = num(m.Radius) ?? 0.02
          shape = {
            kind: 'brush',
            strokes: [{ size: radius, feather: Math.round((1 - (num(m.CenterWeight) ?? 0.5)) * 100), flow: Math.round((num(m.Flow) ?? 1) * 100), density: 100, erase: (num(m.MaskValue) ?? 1) <= 0, dabs: pts }],
          }
        }
      } else if (what === 'Mask/RangeMask') {
        const rm = struct(m.CorrectionRangeMask)
        const type = num(rm?.Type)
        const lr = typeof rm?.LumRange === 'string' ? rm.LumRange.trim().split(/\s+/).map(Number) : []
        // GUESS (LightCraft): Type 2 is a luminance range, LumRange four fractions.
        if (type === 2 && lr.length === 4 && lr.every(Number.isFinite)) shape = { kind: 'luminance', range: lr.map((v) => Math.round(v * 10000) / 100) as [number, number, number, number] }
        else notes.add(`${name}: a ${type === 3 ? 'depth' : 'colour or other'} range mask was left out (its Lightroom format isn’t known).`)
      } else if (what === 'Mask/Image') {
        notes.add(`${name}: an AI mask (Subject, Sky, …) was left out: Lightroom keeps its pixels outside the .xmp.`)
      } else {
        notes.add(`${name}: a part LightBench doesn’t recognise (${what || 'no type'}) was left out.`)
      }
      if (shape) components.push({ id: `lr${i}c${k}`, op: components.length ? op : 'add', invert, shape })
    })
    if (!components.length) return
    const before = components.length
    const amount = num(c.CorrectionAmount)
    out.push({ id: `lr${i}`, name, invert: false, amount: amount === undefined ? 100 : Math.round(Math.min(2, Math.max(0, amount)) * 100), feather: 0, refine: 0, components, adjust })
    const kept = normalizeMasks([out[out.length - 1]])?.[0]
    if (kept && kept.components.length < before) notes.add(`${name}: a range part combined with a brush or gradient was left out (range masks apply to the whole photo in LightBench).`)
  })
  return { masks: normalizeMasks(out) ?? [], notes: [...notes] }
}
