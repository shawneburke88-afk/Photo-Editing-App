// @vitest-environment jsdom
// Lightroom's HSL / Color Mixer fields in sidecars (Phase 3, Part 15), under Part 7's rules.
import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { newPoint, type ColourMixerSettings } from '../engine/develop/colour-mixer'
import { fieldsFromCatalog, fieldsFromRead } from './changes'
import { fromLightroom, LR_HSL_FIELDS, lrDiffers, lrKey, lrState, lrValues, mixerFromLr, mixerToLr, parseLrKey, planLightroomWrite, sameLrKey, type LrFrame } from './lightroom'
import { readXmp, writeXmp, type SidecarData } from './xmp'

// Laid out as Lightroom Classic writes sidecars (written for these tests; no sidecar written by Lightroom was available).
const SIDECAR = (fields: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="2"
   tiff:Orientation="1"
   crs:Version="16.0"
   crs:ProcessVersion="15.4"
   crs:Exposure2012="+0.35"
${fields}
   crs:HasSettings="True">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
const LR_HSL = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']
  .flatMap((b, i) => [`   crs:HueAdjustment${b}="${i === 1 ? '-7' : '0'}"`, `   crs:SaturationAdjustment${b}="${i === 5 ? '-22' : '0'}"`, `   crs:LuminanceAdjustment${b}="${i === 4 ? '+13' : i === 5 ? '-40' : '0'}"`])
  .join('\n')
const FRAME: LrFrame = { stored: [4284, 2844], camera: 1 }
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 2, flag: 0, color: 0, develop: null, ...p })
const Z = [0, 0, 0, 0, 0, 0, 0, 0]

describe('Lightroom HSL / Color Mixer fields', () => {
  it('names the 24 fields as darktable’s importer reads them', () => {
    expect(LR_HSL_FIELDS.length).toBe(24)
    expect(LR_HSL_FIELDS[0]).toBe('HueAdjustmentRed')
    expect(LR_HSL_FIELDS[12]).toBe('SaturationAdjustmentAqua')
    expect(LR_HSL_FIELDS[23]).toBe('LuminanceAdjustmentMagenta')
  })

  it('reads them (signed or not) as LightBench’s 24 sliders, number for number; absent fields are 0', () => {
    const s = lrState(readXmp(SIDECAR(LR_HSL)).lightroom!.fields, FRAME)
    const m = mixerFromLr(undefined, s.hsl!)!
    expect(m.hue[1]).toBe(-7)
    expect(m.saturation[5]).toBe(-22)
    expect(m.luminance[4]).toBe(13)
    expect(m.luminance[5]).toBe(-40)
    expect(mixerToLr(m)).toEqual(s.hsl)
    const one = lrState(readXmp(SIDECAR('   crs:SaturationAdjustmentBlue="+30"')).lightroom!.fields, FRAME)
    expect(one.hsl).toEqual([...Z, 0, 0, 0, 0, 0, 30, 0, 0, ...Z])
  })

  it('treats a sidecar without HSL fields as unknown, not as a difference', () => {
    const none = lrState(readXmp(SIDECAR('')).lightroom!.fields, FRAME)
    expect(none.hsl).toBeNull()
    expect(lrDiffers(DEFAULT_GEOMETRY, none, FRAME, undefined, { hue: Z, saturation: Z.map(() => 50), luminance: Z })).toBe(false)
  })

  it('takes Lightroom’s bands into a photo, keeping its Point Color and darktable settings', () => {
    const s = lrState(readXmp(SIDECAR(LR_HSL)).lightroom!.fields, FRAME)
    expect(lrDiffers(DEFAULT_GEOMETRY, s, FRAME, undefined, undefined)).toBe(true)
    const own: ColourMixerSettings = { hue: Z, saturation: Z, luminance: Z, points: [{ ...newPoint([0.3, 0.2, 0.1]), hueShift: 20 }], advanced: { guided: false, threshold: 0.1, contrast: 0, whiteLevel: 1, placement: 0 } }
    const r = fromLightroom(DEFAULT_GEOMETRY, s, FRAME, undefined, own)
    expect(r.changed).toEqual(['hsl'])
    expect(r.geometry).toBe(DEFAULT_GEOMETRY)
    const m = mixerFromLr(own, r.hsl!)!
    expect(m.saturation[5]).toBe(-22)
    expect(m.points).toEqual(own.points)
    expect(m.advanced?.guided).toBe(false)
    // Already the same: nothing is taken.
    expect(fromLightroom(DEFAULT_GEOMETRY, s, FRAME, undefined, m).changed).toEqual([])
    // All 0 in Lightroom and no bands here: the mixer stays absent.
    expect(mixerFromLr(undefined, [...Z, ...Z, ...Z])).toBeUndefined()
  })

  it('keeps keys stored before this part (no HSL) equal, and new keys round-trip', () => {
    const s = lrState(readXmp(SIDECAR(LR_HSL)).lightroom!.fields, FRAME)
    const old = JSON.stringify({ o: 1, c: null, u: 0, t: [0, 0, 0, 100, 0, 0, 0] })
    expect(sameLrKey(old, lrKey(s))).toBe(true)
    expect(parseLrKey(lrKey(s))!.hsl).toEqual(s.hsl)
    const other = [...s.hsl!]
    other[3] = 5
    expect(sameLrKey(lrKey(s), lrKey({ ...s, hsl: other }))).toBe(false)
  })

  it('writes only the fields LightBench changed, signed, in place, only into Camera Raw sidecars', () => {
    const file = SIDECAR(LR_HSL)
    const r = readXmp(file)
    const adopted = mixerFromLr(undefined, lrState(r.lightroom!.fields, FRAME).hsl!)
    // Opening and saving without a change writes nothing.
    expect(planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, adopted, adopted).groups).toEqual([])
    const more: ColourMixerSettings = { ...adopted!, saturation: adopted!.saturation.map((v, i) => (i === 5 ? -10 : v)), hue: adopted!.hue.map((v, i) => (i === 0 ? 15 : v)) }
    const plan = planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, adopted, more)
    expect(plan.groups).toEqual(['hsl'])
    expect(plan.hslFields).toEqual([0, 13])
    const out = writeXmp(file, data({ lightroom: plan }))!
    expect(out).toContain('crs:HueAdjustmentRed="+15"')
    expect(out).toContain('crs:SaturationAdjustmentBlue="-10"')
    expect(out).toContain('crs:HueAdjustmentOrange="-7"')
    expect(out).toContain('crs:LuminanceAdjustmentAqua="+13"')
    // In place: the changed field is where Lightroom had it.
    expect(out.indexOf('HueAdjustmentRed')).toBeLessThan(out.indexOf('SaturationAdjustmentRed'))
    expect(lrValues({ ...lrState({}, FRAME), hsl: [...Z, ...Z, ...Z] }, 'hsl', undefined, [0])).toEqual([['http://ns.adobe.com/camera-raw-settings/1.0/', 'HueAdjustmentRed', '0']])
    // A sidecar without HSL fields gets none (Lightroom hasn't said anything about them).
    const bare = SIDECAR('')
    expect(planLightroomWrite(readXmp(bare).lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, more).groups).toEqual([])
    // No Camera Raw settings: nothing.
    const plain = writeXmp(null, data())!
    expect(planLightroomWrite(readXmp(plain).lightroom, null, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, more).groups).toEqual([])
  })

  it('notices Lightroom changing its HSL fields as another app’s change', () => {
    const r = readXmp(SIDECAR(LR_HSL))
    const adopted = mixerFromLr(undefined, lrState(r.lightroom!.fields, FRAME).hsl!)
    const develop = JSON.stringify({ geometry: DEFAULT_GEOMETRY, colourMixer: adopted })
    const base = { rating: 2, flag: 0, color: 0, keywords: [], metadata: { title: '', caption: '', creator: '', copyright: '', headline: '', city: '', state: '', country: '' }, develop } as never
    const ours = fieldsFromCatalog(base, FRAME)
    expect(sameLrKey(ours.geometry, fieldsFromRead(r, FRAME).geometry)).toBe(true)
    const changed = readXmp(SIDECAR(LR_HSL.replace('crs:SaturationAdjustmentBlue="-22"', 'crs:SaturationAdjustmentBlue="-30"')))
    expect(sameLrKey(ours.geometry, fieldsFromRead(changed, FRAME).geometry)).toBe(false)
  })
})
