// @vitest-environment jsdom
// Lightroom's Detail panel fields in sidecars (Phase 3, Part 13), under Part 7's rules.
import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { DEFAULT_DETAIL } from '../engine/detail/settings'
import { fieldsFromCatalog, fieldsFromRead } from './changes'
import { detailFromLr, detailToLr, fromLightroom, lrDiffers, lrKey, lrState, parseLrKey, planLightroomWrite, sameLrKey, type LrFrame } from './lightroom'
import { readXmp, writeXmp, type SidecarData } from './xmp'

// Laid out as Lightroom Classic writes sidecars (written for these tests; no sidecar written by Lightroom was available).
const SIDECAR = (detail: string) => `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
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
${detail}
   crs:HasSettings="True">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
const LR_DETAIL = `   crs:Sharpness="40"
   crs:SharpenRadius="+1.0"
   crs:SharpenDetail="25"
   crs:SharpenEdgeMasking="0"
   crs:LuminanceSmoothing="30"
   crs:LuminanceNoiseReductionDetail="50"
   crs:LuminanceNoiseReductionContrast="0"
   crs:ColorNoiseReduction="25"
   crs:ColorNoiseReductionDetail="50"
   crs:ColorNoiseReductionSmoothness="50"`
const FRAME: LrFrame = { stored: [4284, 2844], camera: 1 }
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 2, flag: 0, color: 0, develop: null, ...p })

describe('Lightroom Detail fields', () => {
  it('reads all ten, the radius with its sign, as LightBench’s sliders one for one', () => {
    const r = readXmp(SIDECAR(LR_DETAIL))
    const s = lrState(r.lightroom!.fields, FRAME)
    expect(s.detail).toEqual([40, 1, 25, 0, 30, 50, 0, 25, 50, 50])
    const d = detailFromLr(s.detail!)
    expect(d.sharpen).toEqual({ amount: 40, radius: 1, detail: 25, masking: 0 })
    expect(d.noise).toEqual({ luminance: 30, luminanceDetail: 50, luminanceContrast: 0, color: 25, colorDetail: 50, colorSmoothness: 50 })
    expect(detailToLr(d)).toEqual(s.detail)
  })

  it('fills absent sub-fields with Lightroom’s defaults; no Detail fields at all is unknown, not a difference', () => {
    const r = readXmp(SIDECAR('   crs:LuminanceSmoothing="20"'))
    expect(lrState(r.lightroom!.fields, FRAME).detail).toEqual([0, 1, 25, 0, 20, 50, 0, 0, 50, 50])
    const none = lrState(readXmp(SIDECAR('')).lightroom!.fields, FRAME)
    expect(none.detail).toBeNull()
    expect(lrDiffers(DEFAULT_GEOMETRY, none, FRAME, { ...DEFAULT_DETAIL, noise: { ...DEFAULT_DETAIL.noise, luminance: 60 } })).toBe(false)
  })

  it('takes Lightroom’s Detail into a photo that has none, with its geometry left alone', () => {
    const s = lrState(readXmp(SIDECAR(LR_DETAIL)).lightroom!.fields, FRAME)
    expect(lrDiffers(DEFAULT_GEOMETRY, s, FRAME, undefined)).toBe(true)
    const r = fromLightroom(DEFAULT_GEOMETRY, s, FRAME, undefined)
    expect(r.changed).toEqual(['detail'])
    expect(r.detail?.noise.luminance).toBe(30)
    expect(r.geometry).toBe(DEFAULT_GEOMETRY)
    // Already the same: nothing is taken.
    expect(fromLightroom(DEFAULT_GEOMETRY, s, FRAME, r.detail).changed).toEqual([])
  })

  it('keys stored before this part (no Detail) still compare equal, and new keys round-trip', () => {
    const s = lrState(readXmp(SIDECAR(LR_DETAIL)).lightroom!.fields, FRAME)
    const old = JSON.stringify({ o: 1, c: null, u: 0, t: [0, 0, 0, 100, 0, 0, 0] })
    expect(sameLrKey(old, lrKey(s))).toBe(true)
    expect(parseLrKey(lrKey(s))!.detail).toEqual(s.detail)
    expect(sameLrKey(lrKey(s), lrKey({ ...s, detail: [40, 1, 25, 0, 31, 50, 0, 25, 50, 50] }))).toBe(false)
  })

  it('writes only the fields LightBench changed, only into Camera Raw sidecars', () => {
    const file = SIDECAR(LR_DETAIL)
    const r = readXmp(file)
    const adopted = detailFromLr(lrState(r.lightroom!.fields, FRAME).detail!)
    // Opening and saving without a change writes nothing.
    expect(planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, adopted, adopted).groups).toEqual([])
    const more = { ...adopted, noise: { ...adopted.noise, luminance: 55, luminanceContrast: 10 } }
    const plan = planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, adopted, more)
    expect(plan.groups).toEqual(['detail'])
    expect(plan.detailFields).toEqual([4, 6])
    const out = writeXmp(file, data({ lightroom: plan }))!
    expect(out).toContain('crs:LuminanceSmoothing="55"')
    expect(out).toContain('crs:LuminanceNoiseReductionContrast="10"')
    expect(out).toContain('crs:Sharpness="40"')
    expect(out).toContain('crs:SharpenRadius="+1.0"')
    expect(out).toContain('crs:ColorNoiseReduction="25"')
    // A photo whose LightBench edit predates this part (no Detail in it) turning noise reduction on doesn't reset
    // Lightroom's sharpening or colour noise reduction.
    const own = { ...DEFAULT_DETAIL, noise: { ...DEFAULT_DETAIL.noise, luminance: 30 } }
    const p2 = planLightroomWrite(readXmp(SIDECAR(LR_DETAIL.replace('LuminanceSmoothing="30"', 'LuminanceSmoothing="0"'))).lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, own)
    expect(p2.detailFields).toEqual([4])
    // No Camera Raw settings: nothing.
    const plain = writeXmp(null, data())!
    expect(planLightroomWrite(readXmp(plain).lightroom, null, DEFAULT_GEOMETRY, FRAME, undefined, more).groups).toEqual([])
  })

  it('Lightroom changing its Detail fields is noticed as another app’s change', () => {
    const r = readXmp(SIDECAR(LR_DETAIL))
    const adopted = detailFromLr(lrState(r.lightroom!.fields, FRAME).detail!)
    const develop = JSON.stringify({ geometry: DEFAULT_GEOMETRY, detail: adopted })
    const base = { rating: 2, flag: 0, color: 0, keywords: [], metadata: { title: '', caption: '', creator: '', copyright: '', headline: '', city: '', state: '', country: '' }, develop } as never
    const ours = fieldsFromCatalog(base, FRAME)
    expect(sameLrKey(ours.geometry, fieldsFromRead(r, FRAME).geometry)).toBe(true)
    const changed = readXmp(SIDECAR(LR_DETAIL.replace('crs:Sharpness="40"', 'crs:Sharpness="70"')))
    expect(sameLrKey(ours.geometry, fieldsFromRead(changed, FRAME).geometry)).toBe(false)
  })
})
