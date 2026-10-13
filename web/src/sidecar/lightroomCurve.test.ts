// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CURVE_PRESETS, curveFunction, DEFAULT_TONE_CURVE, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { EMPTY_METADATA } from '../library/metadata'
import { fieldsFromCatalog, fieldsFromRead, judge, mergeForRead, type SidecarState } from './changes'
import type { LrFrame } from './lightroom'
import {
  lrToneDiffers,
  lrToneKey,
  lrToneState,
  LR_LINEAR,
  parseLrPoints,
  parseLrToneKey,
  planToneWrite,
  sameLrTone,
  toneCurveOf,
  toneFromLightroom,
  toneToLightroom,
} from './lightroomCurve'
import { readXmp, writeXmp, type SidecarData } from './xmp'

// A sidecar with a tone curve laid out the way Lightroom Classic writes them (attributes one per line, the curves as
// rdf:Seq elements), written for these tests: no sidecar written by Lightroom was available here.
const LR_CURVE = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="2"
   crs:Version="16.0"
   crs:ProcessVersion="15.4"
   crs:Exposure2012="+0.35"
   crs:ParametricShadows="15"
   crs:ParametricDarks="-10"
   crs:ParametricLights="20"
   crs:ParametricHighlights="-35"
   crs:ParametricShadowSplit="20"
   crs:ParametricMidtoneSplit="45"
   crs:ParametricHighlightSplit="80"
   crs:ToneCurveName2012="Custom"
   crs:HasSettings="True">
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 12</rdf:li>
     <rdf:li>64, 52</rdf:li>
     <rdf:li>192, 205</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Red>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>128, 140</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012Red>
   <crs:ToneCurvePV2012Green>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012Green>
   <crs:ToneCurvePV2012Blue>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012Blue>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 2, flag: 0, color: 0, develop: null, ...p })
const D700: LrFrame = { stored: [4284, 2844], camera: 1 }

describe('reading Lightroom’s tone curve', () => {
  it('reads the point curves, the parametric sliders and splits', () => {
    const r = readXmp(LR_CURVE).lightroomTone!
    expect(r.processVersion).toBe(true)
    expect(r.fields.name).toBe('Custom')
    expect(r.fields.rgb).toEqual([[0, 12], [64, 52], [192, 205], [255, 255]])
    expect(r.fields.red).toEqual([[0, 0], [128, 140], [255, 255]])
    const s = lrToneState(r.fields)
    expect(s.params).toEqual([15, -10, 20, -35, 20, 45, 80])
  })

  it('maps them to LightBench’s curve number for number (x/255, y/255; Regions = the parametric fields)', () => {
    const tc = toneFromLightroom(undefined, lrToneState(readXmp(LR_CURVE).lightroomTone!.fields))!
    expect(tc.rgb[1]).toEqual([0.251, 0.2039])
    expect(tc.rgb[0]).toEqual([0, 0.0471])
    expect(tc.red[1]).toEqual([0.502, 0.549])
    expect(tc.green).toEqual(DEFAULT_TONE_CURVE.green)
    expect(tc.regions).toEqual({ shadows: 15, darks: -10, lights: 20, highlights: -35, splits: [20, 45, 80] })
    // Refine Saturation and the brightness measure are LightBench's own: kept, or its defaults for a new curve
    // (Largest channel at 100 %: Adobe's method).
    expect(tc.saturation).toBe(100)
    expect(tc.norm).toBe('max')
    const kept = toneFromLightroom({ ...DEFAULT_TONE_CURVE, saturation: 40, norm: 'luminance' }, lrToneState(readXmp(LR_CURVE).lightroomTone!.fields))!
    expect(kept.saturation).toBe(40)
    expect(kept.norm).toBe('luminance')
  })

  it('round-trips: LightBench → Lightroom → LightBench', () => {
    const tc: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS[2].points, blue: [[0, 0.05], [0.5, 0.45], [1, 1]], regions: { shadows: 5, darks: 0, lights: -12, highlights: 30, splits: [30, 50, 70] } }
    const s = toLr(tc)
    const back = toneFromLightroom(undefined, s)!
    expect(sameLrTone(toneToLightroom(back), s)).toBe(true)
    for (const x of [0.1, 0.3, 0.6, 0.9]) expect(curveFunction(back.rgb)(x)).toBeCloseTo(curveFunction(tc.rgb)(x), 2)
    expect(back.regions).toEqual(tc.regions)
  })

  it('takes a named preset’s points as they are, without darktable’s parametric offsets', () => {
    const s = lrToneState({ name: 'Medium Contrast', rgb: [[0, 0], [32, 22], [64, 56], [128, 128], [192, 196], [255, 255]], shadows: 50 })
    expect(s.rgb[1]).toEqual([32, 22])
    const tc = toneFromLightroom(undefined, s)!
    expect(curveFunction(tc.rgb)(32 / 255)).toBeCloseTo(22 / 255, 4)
    expect(tc.regions.shadows).toBe(50)
    // A name without points: LightBench's preset of that name stands in.
    expect(lrToneState({ name: 'Strong Contrast' }).rgb).toEqual(toLr({ ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS[2].points }).rgb)
    expect(lrToneState({ name: 'Linear' }).rgb).toEqual(LR_LINEAR)
  })

  it('parses “x, y” items, drops bad ones and duplicates', () => {
    expect(parseLrPoints(['0, 0', ' 128 ,140', 'junk', '128, 1', '300, 300'])).toEqual([[0, 0], [128, 140], [255, 255]])
    expect(parseLrPoints(['5, 5'])).toBeNull()
    expect(parseLrToneKey('{"x":1}')).toBeNull()
    const k = lrToneKey(lrToneState(undefined))
    expect(parseLrToneKey(k)).toEqual(lrToneState(undefined))
  })

  it('is no change for an untouched curve on both sides', () => {
    expect(lrToneDiffers(undefined, lrToneState({ rgb: [[0, 0], [255, 255]], shadows: 0 }))).toBe(false)
    expect(lrToneDiffers(undefined, lrToneState({ shadows: 1 }))).toBe(true)
    expect(toneCurveOf(JSON.stringify({ exposure: 1 }))).toBeUndefined()
    expect(toneCurveOf('{bad')).toBeUndefined()
  })
})

const toLr = (tc: ToneCurveSettings) => toneToLightroom(tc)

describe('writing Lightroom’s tone curve (Part 7’s rules)', () => {
  const ours: ToneCurveSettings = { ...DEFAULT_TONE_CURVE, rgb: CURVE_PRESETS[1].points, regions: { ...DEFAULT_TONE_CURVE.regions, highlights: -20 } }

  it('never writes into a sidecar without Camera Raw settings, or an already-applied one', () => {
    const own = writeXmp(null, data())!
    expect(planToneWrite(readXmp(own).lightroomTone, undefined, ours).groups).toEqual([])
    const applied = LR_CURVE.replace('crs:HasSettings="True"', 'crs:HasSettings="True"\n   crs:AlreadyApplied="True"')
    expect(planToneWrite(readXmp(applied).lightroomTone, undefined, ours).groups).toEqual([])
  })

  it('doesn’t rewrite Lightroom’s curve when a photo is opened or its other settings change', () => {
    const r = readXmp(LR_CURVE)
    const adopted = toneFromLightroom(undefined, lrToneState(r.lightroomTone!.fields))
    // LightBench has read Lightroom's curve: nothing differs, nothing is written.
    expect(planToneWrite(r.lightroomTone, undefined, adopted).groups).toEqual([])
    // An edit made before LightBench read curves (none in the file's LightBench settings, none in LightBench).
    expect(planToneWrite(r.lightroomTone, undefined, undefined).groups).toEqual([])
    const out = writeXmp(LR_CURVE, data({ develop: JSON.stringify({ exposure: 1, toneCurve: adopted }), lightroomTone: planToneWrite(r.lightroomTone, undefined, adopted) }))!
    expect(readXmp(out).lightroomTone!.fields).toEqual(r.lightroomTone!.fields)
  })

  it('writes the groups LightBench changed, in place, and keeps everything else', () => {
    const r = readXmp(LR_CURVE)
    const adopted = toneFromLightroom(undefined, lrToneState(r.lightroomTone!.fields))!
    const first = writeXmp(LR_CURVE, data({ develop: JSON.stringify({ toneCurve: adopted }) }))!
    // Then only Regions are changed in LightBench.
    const changed: ToneCurveSettings = { ...adopted, regions: { ...adopted.regions, highlights: -60 } }
    const r1 = readXmp(first)
    const plan = planToneWrite(r1.lightroomTone, toneCurveOf(r1.develop), changed)
    expect(plan.groups).toEqual(['parametric'])
    const out = writeXmp(first, data({ develop: JSON.stringify({ toneCurve: changed }), lightroomTone: plan }))!
    const f = readXmp(out).lightroomTone!.fields
    expect(f.highlights).toBe(-60)
    expect(f.shadows).toBe(15)
    expect(f.rgb).toEqual(r.lightroomTone!.fields.rgb)
    expect(f.name).toBe('Custom')
    expect(out).toContain('crs:Exposure2012="+0.35"')
    expect(out).toContain('crs:ParametricHighlights="-60"')
    // The marker records the curve both now agree on.
    expect(sameLrTone(parseLrToneKey(readXmp(out).lightroomTone!.marker)!, toneToLightroom(changed))).toBe(true)
    // Now the points: the Seq keeps its element and is rewritten in place.
    const pts: ToneCurveSettings = { ...changed, rgb: CURVE_PRESETS[2].points, green: [[0, 0], [0.5, 0.6], [1, 1]] }
    const r2 = readXmp(out)
    const plan2 = planToneWrite(r2.lightroomTone, toneCurveOf(r2.develop), pts)
    expect(plan2.groups).toEqual(['points'])
    const out2 = writeXmp(out, data({ develop: JSON.stringify({ toneCurve: pts }), lightroomTone: plan2 }))!
    const f2 = readXmp(out2).lightroomTone!.fields
    expect(f2.rgb).toEqual(toLr(pts).rgb)
    expect(f2.green).toEqual([[0, 0], [128, 153], [255, 255]])
    expect(f2.red).toEqual([[0, 0], [128, 140], [255, 255]])
    expect(out2.match(/<crs:ToneCurvePV2012>/g)?.length).toBe(1)
    expect(f2.highlights).toBe(-60)
  })

  it('writes a new curve into a Camera Raw sidecar that had none, as Lightroom-style elements', () => {
    const plain = LR_CURVE.replace(/<crs:ToneCurvePV2012>[\s\S]*<\/crs:ToneCurvePV2012Blue>\n/, '').replace(/\s+crs:Parametric\w+="[^"]*"/g, '').replace(/\s+crs:ToneCurveName2012="[^"]*"/, '')
    const r = readXmp(plain)
    const plan = planToneWrite(r.lightroomTone, undefined, ours)
    expect(plan.groups).toEqual(['parametric', 'points'])
    const out = writeXmp(plain, data({ develop: JSON.stringify({ toneCurve: ours }), lightroomTone: plan }))!
    const f = readXmp(out).lightroomTone!.fields
    expect(f.name).toBe('Custom')
    expect(f.highlights).toBe(-20)
    expect(f.rgb).toEqual(toLr(ours).rgb)
    expect(f.red).toEqual(LR_LINEAR)
    expect(out).toMatch(/<crs:ToneCurvePV2012>\s*<rdf:Seq>/)
  })

  it('after Ignore, LightBench’s curve replaces Lightroom’s on the next write (the marker)', () => {
    const r = readXmp(LR_CURVE)
    const adopted = toneFromLightroom(undefined, lrToneState(r.lightroomTone!.fields))!
    const mine: ToneCurveSettings = { ...adopted, regions: { ...adopted.regions, lights: 5 } }
    const first = writeXmp(LR_CURVE, data({ develop: JSON.stringify({ toneCurve: mine }), lightroomTone: planToneWrite(r.lightroomTone, undefined, mine) }))!
    // Lightroom then changes Lights; the user chooses Ignore (LightBench keeps its own).
    const theirs = first.replace('crs:ParametricLights="5"', 'crs:ParametricLights="40"')
    const r2 = readXmp(theirs)
    expect(planToneWrite(r2.lightroomTone, toneCurveOf(r2.develop), mine).groups).toEqual(['parametric'])
  })
})

describe('noticing Lightroom’s curve changes', () => {
  const state = (p: Partial<SidecarState> = {}): SidecarState => ({ modified: 1000, size: 10, fields: null, external: false, writtenAt: 1, importedAt: 1, ...p })

  it('reports a curve changed in Lightroom and reads it', () => {
    const base = fieldsFromRead(readXmp(LR_CURVE), D700)
    const ours = fieldsFromCatalog({ rating: 2, flag: 0, color: 0, keywords: [], metadata: EMPTY_METADATA, develop: JSON.stringify({ toneCurve: toneFromLightroom(undefined, lrToneState(readXmp(LR_CURVE).lightroomTone!.fields)) }) }, D700)
    expect(ours.toneCurve).toBe(base.toneCurve)
    const changed = LR_CURVE.replace('crs:ParametricDarks="-10"', 'crs:ParametricDarks="25"')
    const theirs = fieldsFromRead(readXmp(changed), D700)
    const v = judge(state({ fields: JSON.stringify(base) }), { lastModified: 9000 }, theirs, ours)
    expect(v.external && v.changed).toEqual(['toneCurve'])
    const patch = mergeForRead(base, ours, theirs)
    expect(parseLrToneKey(patch.toneCurve)!.params[1]).toBe(25)
  })

  it('a record made before LightBench read curves doesn’t report Lightroom’s curve as new', () => {
    const base = fieldsFromRead(readXmp(LR_CURVE), D700)
    delete base.toneCurve
    const ours = fieldsFromCatalog({ rating: 2, flag: 0, color: 0, keywords: [], metadata: EMPTY_METADATA, develop: null }, D700)
    const theirs = fieldsFromRead(readXmp(LR_CURVE), D700)
    const v = judge(state({ fields: JSON.stringify(base) }), { lastModified: 9000 }, theirs, ours)
    expect(v.external).toBe(false)
  })
})
