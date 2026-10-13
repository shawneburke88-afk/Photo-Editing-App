// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, flip, normalizeGeometry, resolveGeometry, rotate90, type GeometrySettings } from '../engine/develop/geometry'
import { DEFAULT_TRANSFORM, normalizeTransform } from '../engine/develop/upright'
import { EMPTY_METADATA } from '../library/metadata'
import { fieldsFromCatalog, fieldsFromRead, judge, mergeForRead, type SidecarState } from './changes'
import {
  exifCode,
  exifMatrix,
  fromLightroom,
  lightroomNote,
  lrFrame,
  lrKey,
  lrState,
  parseLrKey,
  planLightroomWrite,
  sameGroup,
  sameState,
  toLightroom,
  UPRIGHT_CODE,
  type LrFields,
  type LrFrame,
  type LrState,
} from './lightroom'
import { readXmp, writeXmp, type SidecarData } from './xmp'

// A sidecar laid out the way Lightroom Classic writes them (attributes one per line, Camera Raw settings in the
// description), written for these tests: no sidecar written by Lightroom was available here.
const LR_SIDECAR = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="3"
   xmp:CreatorTool="Adobe Photoshop Lightroom Classic 13.0 (Windows)"
   tiff:Orientation="1"
   tiff:ImageWidth="4284"
   tiff:ImageLength="2844"
   xmpMM:DocumentID="xmp.did:0d6c5c1e-8a6b-4d4d-9b0b-0c7c2a1f0e11"
   crs:Version="16.0"
   crs:ProcessVersion="15.4"
   crs:WhiteBalance="As Shot"
   crs:Exposure2012="+0.35"
   crs:CropTop="0.081500"
   crs:CropLeft="0.102300"
   crs:CropBottom="0.902100"
   crs:CropRight="0.881700"
   crs:CropAngle="2.75"
   crs:CropConstrainToWarp="0"
   crs:HasCrop="True"
   crs:PerspectiveUpright="0"
   crs:PerspectiveVertical="0"
   crs:PerspectiveHorizontal="0"
   crs:PerspectiveRotate="0.0"
   crs:PerspectiveScale="100"
   crs:PerspectiveAspect="0"
   crs:PerspectiveX="0.00"
   crs:PerspectiveY="0.00"
   crs:UprightVersion="151388160"
   crs:UprightCenterMode="0"
   crs:HasSettings="True">
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <xmpMM:History>
    <rdf:Seq>
     <rdf:li xmpMM:action="saved" xmpMM:when="2026-10-01T10:00:00+02:00"/>
    </rdf:Seq>
   </xmpMM:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`

const D700: LrFrame = { stored: [4284, 2844], camera: 1 }
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps
const geometry = (g: Partial<GeometrySettings>) => normalizeGeometry({ ...DEFAULT_GEOMETRY, ...g })
const fields = (f: LrFields): LrFields => f
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 3, flag: 0, color: 0, develop: null, ...p })

/** darktable's lightroom.c, translated for the test: the two corners turned about the centre (pixels), before flip. */
function darktableCorners(l: number, t: number, r: number, b: number, cropAngle: number, w: number, h: number) {
  const rangle = (-cropAngle * Math.PI) / 180 // data->pc.angle = -CropAngle; rangle = deg2rad(angle)
  const rot = (x: number, y: number, a: number) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)]
  const [cx, cy] = rot((l - 0.5) * w, (t - 0.5) * h, -rangle) // rotate_xy(&cx, &cy, -rangle)
  const [cw, ch] = rot((r - 0.5) * w, (b - 0.5) * h, -rangle)
  return { cx, cy, cw, ch }
}

describe('Lightroom crop convention', () => {
  it('reads the edges as corners on the stored photo, turned the way darktable turns them', () => {
    const s = lrState(fields({ hasCrop: true, cropLeft: 0.1, cropTop: 0.15, cropRight: 0.85, cropBottom: 0.9, cropAngle: 4 }), D700)
    const g = fromLightroom(DEFAULT_GEOMETRY, s, D700).geometry
    // LightBench's straighten angle turns the other way to CropAngle (darktable and LightCraft's catalog import).
    expect(g.angle).toBe(-4)
    const dt = darktableCorners(0.1, 0.15, 0.85, 0.9, 4, 4284, 2844)
    const [fw, fh] = D700.stored
    expect(close(g.crop.x0 * fw - fw / 2, dt.cx, 1e-6)).toBe(true)
    expect(close(g.crop.y0 * fh - fh / 2, dt.cy, 1e-6)).toBe(true)
    expect(close(g.crop.x1 * fw - fw / 2, dt.cw, 1e-6)).toBe(true)
    expect(close(g.crop.y1 * fh - fh / 2, dt.ch, 1e-6)).toBe(true)
    // The aspect is left unlocked so the crop keeps Lightroom's exact shape.
    expect(g.locked).toBe(false)
  })

  it('matches LightCraft’s catalog import for each orientation (its test vectors)', () => {
    // crates/engine/src/lightroom_catalog.rs `catalog_crops_follow_the_photo_orientation`, stored aspect 1.5.
    const frame = (_orientation: number): LrFrame => ({ stored: [1.5, 1], camera: 1 })
    const crop = (orientation: number) => {
      const s = lrState(fields({ orientation, hasCrop: true, cropLeft: 0.1, cropRight: 0.6, cropTop: 0.2, cropBottom: 0.9 }), frame(orientation))
      const c = fromLightroom(DEFAULT_GEOMETRY, s, frame(orientation)).geometry.crop
      return [c.x0, c.y0, c.x1, c.y1].map((v) => Math.round(v * 1e9) / 1e9)
    }
    expect(crop(1)).toEqual([0.1, 0.2, 0.6, 0.9])
    expect(crop(6)).toEqual([0.1, 0.1, 0.8, 0.6]) // a quarter turn clockwise
    expect(crop(8)).toEqual([0.2, 0.4, 0.9, 0.9]) // a quarter turn anticlockwise
    expect(crop(3)).toEqual([0.4, 0.1, 0.9, 0.8])
    expect(crop(2)).toEqual([0.4, 0.2, 0.9, 0.9]) // mirrored
    const angle = (orientation: number) =>
      fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ orientation, hasCrop: true, cropLeft: 0.2, cropTop: 0.2, cropRight: 0.8, cropBottom: 0.8, cropAngle: 2 }), frame(1)), frame(1)).geometry.angle
    expect(angle(6)).toBe(-2)
    expect(angle(2)).toBe(2) // a mirror turns the straightening the other way
  })

  it('round-trips crops and angles for every orientation (0/90/180/270 and the flips)', () => {
    for (const camera of [1, 3, 6, 8]) {
      const frame: LrFrame = { stored: [6000, 4000], camera }
      for (const turns of [0, 1, 2, 3] as const) {
        for (const mirror of [false, true]) {
          for (const angle of [0, 6.5, -6.5, 12.34]) {
            const g = geometry({ turns, mirror, angle, crop: { x0: 0.2, y0: 0.15, x1: 0.7, y1: 0.8 } })
            const s = toLightroom(g, frame)
            // The photo is as shown in Lightroom: the file's orientation, then LightBench's turns and flips.
            expect(s.orientation).toBe(exifCode(composeFor(turns, mirror, camera)))
            const back = fromLightroom(DEFAULT_GEOMETRY, s, frame).geometry
            expect([back.turns, back.mirror]).toEqual([turns, mirror])
            expect(close(back.angle, angle, 1e-9)).toBe(true)
            for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(close(back.crop[k], g.crop[k], 1e-9)).toBe(true)
            // And back again: the same Lightroom values.
            expect(sameState(toLightroom(back, frame), s)).toBe(true)
          }
        }
      }
    }
  })

  it('keeps the crop on the stored photo when LightBench turns or flips it: only the orientation changes', () => {
    const g = geometry({ angle: 3.5, crop: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.8 } })
    const s0 = toLightroom(g, D700)
    for (const next of [rotate90(g, 1), rotate90(g, -1), rotate90(rotate90(g, 1), 1), flip(g, 'h'), flip(g, 'v')]) {
      const s = toLightroom(next, D700)
      expect(sameGroup(s, s0, 'crop')).toBe(true)
      expect(s.orientation).not.toBe(s0.orientation)
    }
    expect(toLightroom(rotate90(g, 1), D700).orientation).toBe(6)
    expect(toLightroom(rotate90(g, -1), D700).orientation).toBe(8)
    expect(toLightroom(flip(g, 'h'), D700).orientation).toBe(2)
    expect(toLightroom(flip(g, 'v'), D700).orientation).toBe(4)
  })

  it('maps the EXIF orientation codes as EXIF defines them', () => {
    // Where the stored photo's top-left corner (−1, −1) and top-right corner (1, −1) end up on screen.
    const corner = (code: number, x: number, y: number) => {
      const m = exifMatrix(code)
      return [m[0] * x + m[1] * y, m[2] * x + m[3] * y]
    }
    expect(corner(6, -1, -1)).toEqual([1, -1]) // 90° clockwise: top-left goes to the top right
    expect(corner(8, -1, -1)).toEqual([-1, 1])
    expect(corner(3, -1, -1)).toEqual([1, 1])
    expect(corner(2, -1, -1)).toEqual([1, -1]) // mirrored left-right
    expect(corner(4, -1, -1)).toEqual([-1, 1]) // mirrored top-bottom
    expect(corner(5, 1, -1)).toEqual([-1, 1]) // transpose: the top row becomes the left column
    expect(corner(7, 1, -1)).toEqual([1, -1]) // transverse
    for (let c = 1; c <= 8; c++) expect(exifCode(exifMatrix(c))).toBe(c)
  })

  it('reads an orientation from Lightroom as LightBench’s turns on top of the file’s own', () => {
    const frame: LrFrame = { stored: [6000, 4000], camera: 6 } // the camera already says "turned right"
    expect(fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ orientation: 6 }), frame), frame).geometry.turns).toBe(0)
    expect(fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ orientation: 1 }), frame), frame).geometry.turns).toBe(3)
    expect(fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ orientation: 3 }), frame), frame).geometry.turns).toBe(1)
    const m = fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ orientation: 7 }), frame), frame).geometry
    expect(m.mirror).toBe(true)
  })

  it('treats HasCrop False as no crop and ignores edges without HasCrop True', () => {
    expect(lrState(fields({ hasCrop: false, cropLeft: 0.2, cropRight: 0.8 }), D700).crop).toBeNull()
    expect(lrState(fields({ cropLeft: 0.2, cropRight: 0.8 }), D700).crop).toBeNull()
    const cropped = fromLightroom(geometry({ crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, angle: 2, aspect: '1:1', locked: true }), lrState(fields({ hasCrop: false }), D700), D700).geometry
    expect(cropped.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect([cropped.angle, cropped.aspect, cropped.locked]).toEqual([0, 'original', true])
  })

  it('a crop read from Lightroom renders inside the photo (no empty corners)', () => {
    const s = lrState(fields({ hasCrop: true, cropLeft: 0.1023, cropTop: 0.0815, cropRight: 0.8817, cropBottom: 0.9021, cropAngle: 2.75 }), D700)
    const g = fromLightroom(DEFAULT_GEOMETRY, s, D700).geometry
    const r = resolveGeometry(g, 4284, 2844, 0)
    const [w, h] = r.size
    for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
      const m = r.toSensor
      const d = m[6] * x + m[7] * y + m[8]
      const sx = (m[0] * x + m[1] * y + m[2]) / d
      const sy = (m[3] * x + m[4] * y + m[5]) / d
      expect(sx >= -1e-6 && sx <= 4284 + 1e-6 && sy >= -1e-6 && sy <= 2844 + 1e-6).toBe(true)
    }
  })
})

/** The total orientation as LightBench composes it, for the round-trip test. */
function composeFor(turns: number, mirror: boolean, camera: number) {
  const user = toLightroom(geometry({ turns: turns as 0, mirror }), { stored: [2, 1], camera: 1 }).orientation
  const u = exifMatrix(user)
  const c = exifMatrix(camera)
  return [u[0] * c[0] + u[1] * c[2], u[0] * c[1] + u[1] * c[3], u[2] * c[0] + u[3] * c[2], u[2] * c[1] + u[3] * c[3]] as [number, number, number, number]
}

describe('Upright and the Transform sliders', () => {
  it('uses ExifTool’s Upright codes', () => {
    expect(UPRIGHT_CODE).toEqual({ off: 0, auto: 1, full: 2, level: 3, vertical: 4, guided: 5 })
    const mode = (code: number) => fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ upright: code }), D700), D700).geometry.transform?.upright ?? 'off'
    expect([0, 1, 2, 3, 4, 5].map(mode)).toEqual(['off', 'auto', 'full', 'level', 'vertical', 'guided'])
  })

  it('maps the sliders with Lightroom’s signs (Vertical, Horizontal and Aspect reversed), both ways', () => {
    const s = lrState(fields({ upright: 0, vertical: -25, horizontal: 10, rotate: 1.5, scale: 110, aspect: 20, x: 5.5, y: -3 }), D700)
    const t = fromLightroom(DEFAULT_GEOMETRY, s, D700).geometry.transform!
    expect([t.vertical, t.horizontal, t.rotate, t.scale, t.aspect, t.offsetX, t.offsetY]).toEqual([25, -10, 1.5, 110, -20, 5.5, -3])
    expect(toLightroom(geometry({ transform: t }), D700).sliders).toEqual([-25, 10, 1.5, 110, 20, 5.5, -3])
  })

  it('takes Lightroom’s Scale under 100 % as 100 % (LightBench never shows empty edges)', () => {
    expect(fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ scale: 80, vertical: 10 }), D700), D700).geometry.transform!.scale).toBe(100)
  })

  it('a new mode from Lightroom is solved again by LightBench, with a note; Guided says it wasn’t imported', () => {
    const r = fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ upright: 4 }), D700), D700)
    expect(r.rerun).toBe(true)
    expect(r.geometry.transform).toMatchObject({ upright: 'vertical', lightroom: 'vertical', solved: { rotation: 0, vertical: 0, horizontal: 0, shear: 0 } })
    expect(lightroomNote(r.geometry.transform)).toMatch(/Upright Vertical came from Lightroom.*may differ slightly/)
    const g = fromLightroom(DEFAULT_GEOMETRY, lrState(fields({ upright: 5, guides: 2 }), D700), D700)
    expect(g.rerun).toBe(false)
    expect(lightroomNote(g.geometry.transform)).toMatch(/Guided Upright wasn’t imported/)
    // Choosing another mode in LightBench drops the note.
    expect(lightroomNote(normalizeTransform({ ...r.geometry.transform!, upright: 'full' }))).toBeNull()
  })

  it('keeps LightBench’s own solve when Lightroom’s mode is the one LightBench has', () => {
    const t = { ...DEFAULT_TRANSFORM, upright: 'vertical' as const, solved: { rotation: 0.2, vertical: 0.13, horizontal: 0, shear: 0 } }
    const g = geometry({ transform: t })
    const r = fromLightroom(g, lrState(fields({ upright: 4, vertical: -10 }), D700), D700)
    expect(r.rerun).toBe(false)
    expect(r.geometry.transform).toMatchObject({ solved: t.solved, vertical: 10 })
    expect(r.geometry.transform?.lightroom).toBeUndefined()
  })

  it('old edits are unchanged: no transform and no note appear', () => {
    expect(normalizeTransform(undefined)).toBeUndefined()
    expect(normalizeGeometry({ turns: 1, angle: 2 }).transform).toBeUndefined()
    expect('lightroom' in normalizeTransform({ upright: 'auto' })!).toBe(false)
  })
})

describe('reading and writing sidecars', () => {
  it('reads Lightroom’s fields, and nothing for a LightBench sidecar without them', () => {
    const r = readXmp(LR_SIDECAR)
    expect(r.lightroom).toEqual({
      fields: { orientation: 1, hasCrop: true, cropLeft: 0.1023, cropTop: 0.0815, cropRight: 0.8817, cropBottom: 0.9021, cropAngle: 2.75, upright: 0, vertical: 0, horizontal: 0, rotate: 0, scale: 100, aspect: 0, x: 0, y: 0 },
      processVersion: true,
      applied: false,
    })
    const own = writeXmp(null, data({ develop: JSON.stringify({ geometry: { crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 } } }) }))!
    expect(readXmp(own).lightroom).toBeUndefined()
  })

  it('opening a Lightroom-cropped photo doesn’t rewrite Lightroom’s fields', () => {
    const r = readXmp(LR_SIDECAR)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    const plan = planLightroomWrite(r.lightroom, null, adopted, D700)
    expect(plan.groups).toEqual([])
    const out = writeXmp(LR_SIDECAR, data({ develop: JSON.stringify({ geometry: adopted }), lightroom: plan }))!
    for (const m of LR_SIDECAR.matchAll(/ (crs|tiff):(\w+)="([^"]*)"/g)) expect(out).toContain(m[0].trim())
    // Not even before LightBench has read the crop (no edit yet), or when reading it failed.
    expect(planLightroomWrite(r.lightroom, null, DEFAULT_GEOMETRY, D700).groups).toEqual([])
  })

  it('writes a crop changed in LightBench, keeping every other field and namespace as it was', () => {
    const r = readXmp(LR_SIDECAR)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    const first = writeXmp(LR_SIDECAR, data({ develop: JSON.stringify({ geometry: adopted }), lightroom: planLightroomWrite(r.lightroom, null, adopted, D700) }))!
    // The user crops tighter and straightens differently in LightBench.
    const changed = { ...adopted, angle: -1.5, crop: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.75 } }
    const r1 = readXmp(first)
    const plan = planLightroomWrite(r1.lightroom, normalizeGeometry(JSON.parse(r1.develop!).geometry), changed, D700)
    expect(plan.groups).toEqual(['crop'])
    const out = writeXmp(first, data({ develop: JSON.stringify({ geometry: changed }), lightroom: plan }))!
    const mine = new Set(['CropTop', 'CropLeft', 'CropBottom', 'CropRight', 'CropAngle', 'HasCrop'])
    // Every other attribute keeps its exact text, and every element (tone curve, history) its exact markup.
    for (const m of LR_SIDECAR.matchAll(/ ((?:\w+):(\w+))="([^"]*)"/g)) if (!(m[1].startsWith('crs:') && mine.has(m[2])) && m[1] !== 'xmp:Rating') expect(out).toContain(m[0].trim())
    for (const el of ['<crs:ToneCurvePV2012>\n    <rdf:Seq>\n     <rdf:li>0, 0</rdf:li>\n     <rdf:li>255, 255</rdf:li>\n    </rdf:Seq>\n   </crs:ToneCurvePV2012>', '<xmpMM:History>\n    <rdf:Seq>\n     <rdf:li xmpMM:action="saved" xmpMM:when="2026-10-01T10:00:00+02:00"/>\n    </rdf:Seq>\n   </xmpMM:History>']) {
      expect(out).toContain(el)
    }
    // The crop fields are changed where they were (their order among the others is kept).
    const order = [...out.matchAll(/crs:(\w+)=/g)].map((m) => m[1])
    expect(order.indexOf('CropTop')).toBe(order.indexOf('Exposure2012') + 1)
    expect(order.indexOf('HasCrop')).toBe(order.indexOf('CropConstrainToWarp') + 1)
    // Lightroom reads back LightBench's crop (the same conversion LightBench reads with).
    const back = fromLightroom(DEFAULT_GEOMETRY, lrState(readXmp(out).lightroom!.fields, D700), D700).geometry
    expect(close(back.angle, -1.5, 1e-6)).toBe(true)
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(close(back.crop[k], changed.crop[k], 2e-6)).toBe(true)
    expect(out).toContain('crs:CropAngle="1.5"')
    // The Transform fields were left alone: LightBench didn't change them.
    expect(out).toContain('crs:PerspectiveX="0.00"')
  })

  it('updates fields Lightroom wrote as elements in place', () => {
    const el = LR_SIDECAR.replace('   crs:CropTop="0.081500"\n', '').replace('<crs:ToneCurvePV2012>', '<crs:CropTop>0.081500</crs:CropTop>\n   <crs:ToneCurvePV2012>')
    const r = readXmp(el)
    expect(r.lightroom!.fields.cropTop).toBe(0.0815)
    const changed = { ...fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry, angle: 0, crop: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 } }
    const out = writeXmp(el, data({ lightroom: planLightroomWrite(r.lightroom, null, changed, D700) }))!
    expect(out).toContain('<crs:CropTop>0.250000</crs:CropTop>')
    expect(out).not.toContain('crs:CropTop=')
  })

  it('writes orientation and Transform only when LightBench changed them', () => {
    const r = readXmp(LR_SIDECAR)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    const turned = rotate90(adopted, 1)
    const plan = planLightroomWrite(r.lightroom, adopted, turned, D700)
    expect(plan.groups).toEqual(['orientation'])
    const out = writeXmp(LR_SIDECAR, data({ lightroom: plan }))!
    expect(out).toContain('tiff:Orientation="6"')
    expect(out).toContain('crs:CropTop="0.081500"') // the crop is on the stored photo: unchanged
    const upright = { ...adopted, transform: { ...DEFAULT_TRANSFORM, upright: 'vertical' as const, vertical: 15 } }
    const p2 = planLightroomWrite(r.lightroom, adopted, upright, D700)
    expect(p2.groups).toEqual(['transform'])
    const out2 = writeXmp(LR_SIDECAR, data({ lightroom: p2 }))!
    expect(out2).toContain('crs:PerspectiveUpright="4"')
    expect(out2).toContain('crs:PerspectiveVertical="-15"')
    expect(out2).toContain('crs:UprightVersion="151388160"') // Lightroom's solved Upright fields aren't touched
  })

  it('writes nothing into a sidecar without Camera Raw settings, or an already-applied one', () => {
    const own = writeXmp(null, data())!
    const cropped = geometry({ crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 } })
    expect(planLightroomWrite(readXmp(own).lightroom, null, cropped, D700).groups).toEqual([])
    const applied = LR_SIDECAR.replace('crs:HasSettings="True"', 'crs:HasSettings="True"\n   crs:AlreadyApplied="True"')
    expect(planLightroomWrite(readXmp(applied).lightroom, null, cropped, D700).groups).toEqual([])
    // An exported (already-applied) file's crop is not read either.
    expect(fieldsFromRead(readXmp(applied), D700).geometry).toBe(lrKey(lrState(undefined, D700)))
  })

  it('an edit made before this version keeps LightBench’s geometry until it is changed in LightBench', () => {
    const r = readXmp(LR_SIDECAR)
    const old = geometry({ crop: { x0: 0, y0: 0, x1: 0.5, y1: 1 } }) // LightBench's own crop, made without reading Lightroom's
    expect(planLightroomWrite(r.lightroom, old, old, D700).groups).toEqual([])
    const changed = { ...old, crop: { x0: 0, y0: 0, x1: 0.6, y1: 1 } }
    expect(planLightroomWrite(r.lightroom, old, changed, D700).groups).toEqual(['crop'])
  })

  it('after Ignore, LightBench’s geometry replaces Lightroom’s changed fields (the marker)', () => {
    const r = readXmp(LR_SIDECAR)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    const written = writeXmp(LR_SIDECAR, data({ develop: JSON.stringify({ geometry: adopted }), lightroom: planLightroomWrite(r.lightroom, null, adopted, D700) }))!
    expect(written).toContain('lightbench:LightroomGeometry=')
    // Lightroom changes the crop; the user chooses Ignore; LightBench's geometry hasn't changed.
    const lrChanged = written.replace('crs:CropTop="0.081500"', 'crs:CropTop="0.300000"')
    const r2 = readXmp(lrChanged)
    expect(planLightroomWrite(r2.lightroom, normalizeGeometry(JSON.parse(r2.develop!).geometry), adopted, D700).groups).toEqual(['crop'])
  })
})

describe('noticing Lightroom’s changes (Read changes)', () => {
  const state = (s: Partial<SidecarState> = {}): SidecarState => ({ modified: 1000, size: 500, fields: null, external: false, writtenAt: null, importedAt: 100, ...s })
  const ours = (develop: string | null) => fieldsFromCatalog({ rating: 3, flag: 0, color: 0, keywords: [], metadata: { ...EMPTY_METADATA }, develop }, D700)

  it('a crop changed in Lightroom is another app’s change, and Read changes takes it', () => {
    const r = readXmp(LR_SIDECAR)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    const develop = JSON.stringify({ geometry: adopted })
    const base = fieldsFromRead(r, D700)
    const changed = LR_SIDECAR.replace('crs:CropTop="0.081500"', 'crs:CropTop="0.200000"')
    const theirs = fieldsFromRead(readXmp(changed), D700)
    const v = judge(state({ fields: JSON.stringify(base) }), { lastModified: 9000 }, theirs, ours(develop))
    expect(v).toEqual({ external: true, changed: ['geometry'], conflicts: [] })
    const p = mergeForRead(base, ours(develop), theirs)
    expect(p.geometry).toBe(theirs.geometry)
    const applied = fromLightroom(adopted, lrState(readXmp(changed).lightroom!.fields, D700), D700)
    expect(applied.changed).toEqual(['crop'])
  })

  it('a Lightroom crop LightBench didn’t read before isn’t reported when the record predates it', () => {
    const r = readXmp(LR_SIDECAR)
    const old = fieldsFromRead(r) // a record made before LightBench read Lightroom's geometry
    const theirs = fieldsFromRead(readXmp(LR_SIDECAR.replace('xmp:Rating="3"', 'xmp:Rating="5"')), D700)
    const v = judge(state({ fields: JSON.stringify(old) }), { lastModified: 9000 }, theirs, ours(null))
    expect(v).toEqual({ external: true, changed: ['rating'], conflicts: [] })
    expect(mergeForRead(old, ours(null), theirs).geometry).toBeUndefined()
  })

  it('changes to Lightroom fields LightBench doesn’t use aren’t reported', () => {
    const r = readXmp(LR_SIDECAR)
    const base = fieldsFromRead(r, D700)
    const theirs = fieldsFromRead(readXmp(LR_SIDECAR.replace('crs:UprightVersion="151388160"', 'crs:UprightVersion="151388161"').replace('crs:CropConstrainToWarp="0"', 'crs:CropConstrainToWarp="1"')), D700)
    const adopted = fromLightroom(DEFAULT_GEOMETRY, lrState(r.lightroom!.fields, D700), D700).geometry
    expect(judge(state({ fields: JSON.stringify(base) }), { lastModified: 9000 }, theirs, ours(JSON.stringify({ geometry: adopted }))).external).toBe(false)
  })
})

describe('frames', () => {
  it('builds the stored frame from the catalog (LibRaw orientation codes)', () => {
    expect(lrFrame({ width: 6000, height: 4000, orientation: 6 })).toEqual({ stored: [6000, 4000], camera: 6 })
    expect(lrFrame({ width: 6000, height: 4000, orientation: 5 }).camera).toBe(8)
    expect(lrFrame({ width: 0, height: 0, orientation: 0 })).toEqual({ stored: [3, 2], camera: 1 })
  })

  it('the key round-trips and compares within the file’s precision', () => {
    const s: LrState = { orientation: 6, crop: [0.1, 0.2, 0.8, 0.9, 1.25], upright: 4, sliders: [-10, 0, 0.5, 100, 0, 1.5, 0] }
    expect(parseLrKey(lrKey(s))).toEqual(s)
    expect(parseLrKey('not json')).toBeNull()
    expect(sameState({ ...s, crop: [0.1000004, 0.2, 0.8, 0.9, 1.25] }, s)).toBe(true)
    expect(sameState({ ...s, crop: [0.1001, 0.2, 0.8, 0.9, 1.25] }, s)).toBe(false)
  })
})
