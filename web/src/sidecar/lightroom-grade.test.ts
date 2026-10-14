// @vitest-environment jsdom
// Lightroom's Color Grading / Split Toning fields in sidecars (Phase 3, Part 17), under Part 7's rules.
import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { DEFAULT_GRADING, DEFAULT_GRADING_ADVANCED, type ColourGradingSettings } from '../engine/develop/colour-grading'
import { fieldsFromCatalog, fieldsFromRead } from './changes'
import { fromLightroom, gradingFromLr, gradingToLr, LR_GRADE_FIELDS, lrDiffers, lrKey, lrState, lrValues, parseLrKey, planLightroomWrite, sameLrKey, type LrFrame } from './lightroom'
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
const GRADE = `   crs:SplitToningShadowHue="210"
   crs:SplitToningShadowSaturation="25"
   crs:SplitToningHighlightHue="40"
   crs:SplitToningHighlightSaturation="30"
   crs:SplitToningBalance="+20"
   crs:ColorGradeMidtoneHue="0"
   crs:ColorGradeMidtoneSat="0"
   crs:ColorGradeShadowLum="-10"
   crs:ColorGradeMidtoneLum="0"
   crs:ColorGradeHighlightLum="+5"
   crs:ColorGradeBlending="60"
   crs:ColorGradeGlobalHue="30"
   crs:ColorGradeGlobalSat="8"
   crs:ColorGradeGlobalLum="0"`
// A sidecar from before Color Grading (Lightroom Classic 9 and older): Split Toning only.
const SPLIT = `   crs:SplitToningShadowHue="220"
   crs:SplitToningShadowSaturation="20"
   crs:SplitToningHighlightHue="45"
   crs:SplitToningHighlightSaturation="35"
   crs:SplitToningBalance="-10"`
const ZERO_SPLIT = SPLIT.replace(/Saturation="\d+"/g, 'Saturation="0"').replace(/Balance="-10"/, 'Balance="0"')
const FRAME: LrFrame = { stored: [4284, 2844], camera: 1 }
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 2, flag: 0, color: 0, develop: null, ...p })
const read = (fields: string) => lrState(readXmp(SIDECAR(fields)).lightroom!.fields, FRAME)

describe('Lightroom Color Grading fields', () => {
  it('names the hybrid fields (ExifTool 3.79): Split Toning for Shadows/Highlights hue and saturation and Balance, ColorGrade* for the rest', () => {
    expect(LR_GRADE_FIELDS).toEqual([
      'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum',
      'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum',
      'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum',
      'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum',
      'ColorGradeBlending', 'SplitToningBalance',
    ])
    expect(LR_GRADE_FIELDS.some((f) => f === ('ColorGradeShadowHue' as string))).toBe(false)
  })

  it('reads a Color Grading sidecar number for number (hues as degrees: unverified)', () => {
    const s = read(GRADE)
    const g = gradingFromLr(undefined, s.grade!)!
    expect(g.shadows).toEqual({ hue: 210, sat: 25, lum: -10 })
    expect(g.highlights).toEqual({ hue: 40, sat: 30, lum: 5 })
    expect(g.global).toEqual({ hue: 30, sat: 8, lum: 0 })
    expect([g.blending, g.balance]).toEqual([60, 20])
    expect(gradingToLr(g)).toEqual(s.grade)
  })

  it('reads an old Split Toning sidecar (no ColorGradeBlending) with Blending 100, the Midtones and Global at 0', () => {
    const s = read(SPLIT)
    expect(s.grade![12]).toBe(100)
    const g = gradingFromLr(undefined, s.grade!)!
    expect(g.shadows).toEqual({ hue: 220, sat: 20, lum: 0 })
    expect(g.highlights).toEqual({ hue: 45, sat: 35, lum: 0 })
    expect(g.midtones).toEqual({ hue: 0, sat: 0, lum: 0 })
    expect([g.blending, g.balance]).toEqual([100, -10])
    // ColorGrade fields without Blending (not seen from Lightroom; LightBench reads Lightroom's default 50).
    expect(read('   crs:ColorGradeMidtoneHue="40"\n   crs:ColorGradeMidtoneSat="10"').grade![12]).toBe(50)
  })

  it('treats a sidecar without the fields as unknown, and Split Toning at 0 as no grade (no step, no key)', () => {
    const none = read('')
    expect(none.grade).toBeNull()
    expect(lrDiffers(DEFAULT_GEOMETRY, none, FRAME, undefined, undefined, { ...DEFAULT_GRADING, shadows: { hue: 200, sat: 40, lum: 0 } })).toBe(false)
    const zero = read(ZERO_SPLIT)
    expect(zero.grade![12]).toBe(100)
    expect(lrDiffers(DEFAULT_GEOMETRY, zero, FRAME)).toBe(false)
    expect(gradingFromLr(undefined, zero.grade!)).toBeUndefined()
  })

  it('takes Lightroom’s grade into a photo, keeping its darktable settings', () => {
    const s = read(GRADE)
    expect(lrDiffers(DEFAULT_GEOMETRY, s, FRAME)).toBe(true)
    const own: ColourGradingSettings = { ...DEFAULT_GRADING, advanced: { ...DEFAULT_GRADING_ADVANCED, vibrance: 20 } }
    const r = fromLightroom(DEFAULT_GEOMETRY, s, FRAME, undefined, undefined, own)
    expect(r.changed).toEqual(['grade'])
    const g = gradingFromLr(own, r.grade!)!
    expect(g.shadows.sat).toBe(25)
    expect(g.advanced?.vibrance).toBe(20)
    expect(fromLightroom(DEFAULT_GEOMETRY, s, FRAME, undefined, undefined, g).changed).toEqual([])
  })

  it('keeps keys stored before this part (no grade) equal, and new keys round-trip', () => {
    const s = read(GRADE)
    const old = JSON.stringify({ o: 1, c: null, u: 0, t: [0, 0, 0, 100, 0, 0, 0] })
    expect(sameLrKey(old, lrKey(s))).toBe(true)
    expect(parseLrKey(lrKey(s))!.grade).toEqual(s.grade)
    const other = [...s.grade!]
    other[1] = 40
    expect(sameLrKey(lrKey(s), lrKey({ ...s, grade: other }))).toBe(false)
    // A hue without saturation doesn't count.
    const hueOnly = [...s.grade!]
    hueOnly[3] = 77
    expect(sameLrKey(lrKey(s), lrKey({ ...s, grade: hueOnly }))).toBe(true)
  })

  it('writes only the fields LightBench changed, in place, signed where Lightroom signs, only into Camera Raw sidecars', () => {
    const file = SIDECAR(GRADE)
    const r = readXmp(file)
    const adopted = gradingFromLr(undefined, lrState(r.lightroom!.fields, FRAME).grade!)!
    expect(planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, adopted, adopted).groups).toEqual([])
    const more: ColourGradingSettings = { ...adopted, shadows: { hue: 200, sat: 25, lum: 15 }, balance: -5 }
    const plan = planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, adopted, more)
    expect(plan.groups).toEqual(['grade'])
    expect(plan.gradeFields).toEqual([0, 2, 13])
    const out = writeXmp(file, data({ lightroom: plan }))!
    expect(out).toContain('crs:SplitToningShadowHue="200"')
    expect(out).toContain('crs:ColorGradeShadowLum="+15"')
    expect(out).toContain('crs:SplitToningBalance="-5"')
    expect(out).toContain('crs:ColorGradeBlending="60"')
    expect(out.indexOf('SplitToningShadowHue')).toBeLessThan(out.indexOf('SplitToningShadowSaturation'))
    expect(lrValues({ ...lrState({}, FRAME), grade: gradingToLr(undefined) }, 'grade', undefined, undefined, [12, 13])).toEqual([
      ['http://ns.adobe.com/camera-raw-settings/1.0/', 'ColorGradeBlending', '50'],
      ['http://ns.adobe.com/camera-raw-settings/1.0/', 'SplitToningBalance', '0'],
    ])
    // A saturation raised from 0 writes its hue too.
    const tinted: ColourGradingSettings = { ...adopted, midtones: { hue: 120, sat: 10, lum: 0 } }
    expect(planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, adopted, tinted).gradeFields).toEqual([3, 4])
    // No grading fields: none written. No Camera Raw settings: nothing.
    expect(planLightroomWrite(readXmp(SIDECAR('')).lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, undefined, more).groups).toEqual([])
    const plain = writeXmp(null, data())!
    expect(planLightroomWrite(readXmp(plain).lightroom, null, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, undefined, more).groups).toEqual([])
  })

  it('writes ColorGradeBlending into an old Split Toning sidecar with the first change, so it still reads as 100', () => {
    const file = SIDECAR(SPLIT)
    const r = readXmp(file)
    const adopted = gradingFromLr(undefined, lrState(r.lightroom!.fields, FRAME).grade!)!
    const more: ColourGradingSettings = { ...adopted, highlights: { ...adopted.highlights, lum: 10 } }
    const plan = planLightroomWrite(r.lightroom, DEFAULT_GEOMETRY, DEFAULT_GEOMETRY, FRAME, undefined, undefined, undefined, undefined, adopted, more)
    expect(plan.gradeFields).toEqual([8, 12])
    const out = writeXmp(file, data({ lightroom: plan }))!
    expect(out).toContain('crs:ColorGradeHighlightLum="+10"')
    expect(out).toContain('crs:ColorGradeBlending="100"')
    const again = lrState(readXmp(out).lightroom!.fields, FRAME)
    expect(gradingFromLr(undefined, again.grade!)).toEqual(more)
  })

  it('notices Lightroom changing its grade as another app’s change', () => {
    const r = readXmp(SIDECAR(GRADE))
    const adopted = gradingFromLr(undefined, lrState(r.lightroom!.fields, FRAME).grade!)
    const develop = JSON.stringify({ geometry: DEFAULT_GEOMETRY, colourGrading: adopted })
    const base = { rating: 2, flag: 0, color: 0, keywords: [], metadata: { title: '', caption: '', creator: '', copyright: '', headline: '', city: '', state: '', country: '' }, develop } as never
    const ours = fieldsFromCatalog(base, FRAME)
    expect(sameLrKey(ours.geometry, fieldsFromRead(r, FRAME).geometry)).toBe(true)
    const changed = readXmp(SIDECAR(GRADE.replace('crs:SplitToningHighlightSaturation="30"', 'crs:SplitToningHighlightSaturation="45"')))
    expect(sameLrKey(ours.geometry, fieldsFromRead(changed, FRAME).geometry)).toBe(false)
  })
})
