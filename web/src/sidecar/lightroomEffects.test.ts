// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_GLOW, DEFAULT_GRAIN, DEFAULT_VIGNETTE, type EffectsSettings } from '../engine/develop/effects'
import { DEFAULT_SETTINGS, normalizeSettings } from '../engine/develop/settings'
import { EMPTY_METADATA } from '../library/metadata'
import { fieldsFromCatalog, fieldsFromRead, mergeForRead } from './changes'
import type { LrFrame } from './lightroom'
import {
  effectsOf,
  fxFromLightroom,
  fxToLightroom,
  glowFromLightroom,
  LR_FX_FIELDS,
  lrFxDiffers,
  lrFxKey,
  lrFxState,
  lrFxValues,
  parseLrFxKey,
  planFxWrite,
  sameLrFx,
} from './lightroomEffects'
import { readXmp, writeXmp, type SidecarData } from './xmp'

// A Camera Raw sidecar with the Effects fields, written for these tests from the field names Exiv2, the Lightroom SDK,
// darktable's importer and (Glow) a third-party source give: no sidecar written by Lightroom was available here.
const LR_FX = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="3"
   crs:Version="16.0"
   crs:ProcessVersion="15.4"
   crs:Exposure2012="+0.35"
   crs:Texture="+22"
   crs:Clarity2012="-14"
   crs:Dehaze="+30"
   crs:PostCropVignetteAmount="-35"
   crs:PostCropVignetteMidpoint="40"
   crs:PostCropVignetteFeather="65"
   crs:PostCropVignetteRoundness="+10"
   crs:PostCropVignetteStyle="2"
   crs:PostCropVignetteHighlightContrast="20"
   crs:GrainAmount="25"
   crs:GrainSize="30"
   crs:GrainFrequency="60"
   crs:GlowStyle="Halation"
   crs:GlowRange="70"
   crs:GlowSpread="40"
   crs:GlowWarmth="-20"
   crs:HasSettings="True"/>
 </rdf:RDF>
</x:xmpmeta>
`
const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 3, flag: 0, color: 0, develop: null, ...p })
const FRAME: LrFrame = { stored: [4000, 3000], camera: 1 }

describe('reading Lightroom’s Effects fields', () => {
  it('reads Texture, Clarity, Dehaze, the vignette and grain, and Glow’s fields as text', () => {
    const r = readXmp(LR_FX).lightroomFx!
    expect(r.processVersion).toBe(true)
    expect(r.applied).toBe(false)
    expect(r.fields).toEqual([22, -14, 30, -35, 40, 10, 65, 20, 2, 25, 30, 60])
    expect(r.glow).toEqual({ GlowStyle: 'Halation', GlowRange: '70', GlowSpread: '40', GlowWarmth: '-20' })
  })

  it('maps them one for one (GrainFrequency as Roughness; Style 2 as Color Priority)', () => {
    const r = readXmp(LR_FX).lightroomFx!
    const fx = fxFromLightroom(undefined, lrFxState(r.fields), glowFromLightroom(r.glow), () => 0.5)!
    expect([fx.texture, fx.clarity, fx.dehaze]).toEqual([22, -14, 30])
    expect(fx.vignette).toEqual({ ...DEFAULT_VIGNETTE, amount: -35, midpoint: 40, roundness: 10, feather: 65, highlights: 20, style: 'colour' })
    expect(fx.grain).toEqual({ ...DEFAULT_GRAIN, amount: 25, size: 30, roughness: 60, seed: 1 + Math.floor(0.5 * 2147483646) })
    // Glow: its settings, but no amount (its field isn't known): off until the user sets one.
    expect(fx.glow).toEqual({ ...DEFAULT_GLOW, style: 'halation', range: 70, spread: 40, warmth: -20 })
  })

  it('absent fields are Lightroom’s defaults; an untouched sidecar changes nothing', () => {
    expect(lrFxState(undefined).values).toEqual([0, 0, 0, 0, 50, 0, 50, 0, 1, 0, 25, 50])
    expect(lrFxDiffers(undefined, lrFxState([]))).toBe(false)
    expect(fxFromLightroom(undefined, lrFxState([]))).toBeUndefined()
    // A vignette or grain at Amount 0 is no difference whatever its other numbers.
    expect(sameLrFx(lrFxState([0, 0, 0, 0, 10]), lrFxState([]))).toBe(true)
  })

  it('damaged or unknown values are read safely', () => {
    expect(glowFromLightroom({ GlowStyle: '2', GlowRange: 'abc' })).toBeUndefined()
    expect(glowFromLightroom({ GlowRange: '300' })).toEqual({ range: 100 })
    const bad = LR_FX.replace('crs:Texture="+22"', 'crs:Texture="lots"').replace('crs:PostCropVignetteStyle="2"', 'crs:PostCropVignetteStyle="9"')
    const r = readXmp(bad).lightroomFx!
    expect(r.fields[0]).toBeUndefined()
    const fx = fxFromLightroom(undefined, lrFxState(r.fields))!
    expect(fx.texture).toBeUndefined()
    expect(fx.vignette!.style).toBe('highlight')
    expect(parseLrFxKey('[1,2]')).toBeNull()
    expect(parseLrFxKey('{bad')).toBeNull()
    expect(effectsOf('{bad')).toBeUndefined()
  })

  it('keeps what Lightroom has no field for (the vignette’s centre and shape, colour grain, a grain seed)', () => {
    const ours: EffectsSettings = { vignette: { ...DEFAULT_VIGNETTE, amount: -10, centerX: 30, shape: 2 }, grain: { ...DEFAULT_GRAIN, amount: 10, colour: true, seed: 77 } }
    const r = readXmp(LR_FX).lightroomFx!
    const fx = fxFromLightroom(ours, lrFxState(r.fields))!
    expect(fx.vignette!.centerX).toBe(30)
    expect(fx.vignette!.shape).toBe(2)
    expect(fx.grain!.colour).toBe(true)
    expect(fx.grain!.seed).toBe(77)
  })
})

describe('writing them (Part 7’s rules); Glow never', () => {
  it('never into a sidecar without Camera Raw settings, or an already-applied one', () => {
    const ours: EffectsSettings = { texture: 40 }
    const own = writeXmp(null, data())!
    expect(planFxWrite(readXmp(own).lightroomFx, undefined, ours).groups).toEqual([])
    const applied = LR_FX.replace('crs:HasSettings="True"', 'crs:HasSettings="True"\n   crs:AlreadyApplied="True"')
    expect(planFxWrite(readXmp(applied).lightroomFx, undefined, ours).groups).toEqual([])
  })

  it('doesn’t rewrite Lightroom’s values when LightBench has read them, or an old edit that never did', () => {
    const r = readXmp(LR_FX)
    const adopted = fxFromLightroom(undefined, lrFxState(r.lightroomFx!.fields))
    expect(planFxWrite(r.lightroomFx, undefined, adopted).groups).toEqual([])
    expect(planFxWrite(r.lightroomFx, undefined, undefined).groups).toEqual([])
  })

  it('writes the groups LightBench changed, in place, and keeps the rest (Glow’s fields untouched)', () => {
    const r = readXmp(LR_FX)
    const adopted = fxFromLightroom(undefined, lrFxState(r.lightroomFx!.fields), glowFromLightroom(r.lightroomFx!.glow))!
    const first = writeXmp(LR_FX, data({ develop: JSON.stringify({ effects: adopted }) }))!
    const changed: EffectsSettings = { ...adopted, clarity: 35, glow: { ...adopted.glow!, amount: 60, range: 10 } }
    const r1 = readXmp(first)
    const plan = planFxWrite(r1.lightroomFx, effectsOf(r1.develop), changed)
    expect(plan.groups).toEqual(['presence'])
    expect(lrFxValues(plan).map((v) => v.local)).toEqual(['Texture', 'Clarity2012', 'Dehaze'])
    // No Glow field is ever among the values written.
    expect(lrFxValues({ ...plan, groups: ['presence', 'vignette', 'grain'] }).some((v) => v.local.startsWith('Glow'))).toBe(false)
    const out = writeXmp(first, data({ develop: JSON.stringify({ effects: changed }), lightroomFx: plan }))!
    expect(out).toContain('crs:Clarity2012="+35"')
    expect(out).toContain('crs:GlowRange="70"')
    expect(out).toContain('crs:PostCropVignetteAmount="-35"')
    expect(out).toContain('crs:Exposure2012="+0.35"')
    expect(sameLrFx(parseLrFxKey(readXmp(out).lightroomFx!.marker)!, fxToLightroom(changed))).toBe(true)
    // The vignette next: only its fields.
    const v2: EffectsSettings = { ...changed, vignette: { ...changed.vignette!, amount: -60, style: 'paint' } }
    const r2 = readXmp(out)
    const plan2 = planFxWrite(r2.lightroomFx, effectsOf(r2.develop), v2)
    expect(plan2.groups).toEqual(['vignette'])
    const out2 = writeXmp(out, data({ develop: JSON.stringify({ effects: v2 }), lightroomFx: plan2 }))!
    expect(out2).toContain('crs:PostCropVignetteAmount="-60"')
    expect(out2).toContain('crs:PostCropVignetteStyle="3"')
    expect(out2.match(/PostCropVignetteAmount/g)?.length).toBe(1)
  })

  it('every field LightBench writes is one it reads', () => {
    const plan = planFxWrite({ fields: [], glow: {}, processVersion: true, applied: false }, undefined, { texture: 1, vignette: { ...DEFAULT_VIGNETTE, amount: 5 }, grain: { ...DEFAULT_GRAIN, amount: 5 } })
    expect(plan.groups).toEqual(['presence', 'vignette', 'grain'])
    expect(lrFxValues(plan).map((v) => v.local)).toEqual([...LR_FX_FIELDS])
  })
})

describe('the sidecar round trip and Read changes', () => {
  it('LightBench’s effects round-trip through lightbench:Develop; a damaged one reads safely', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, effects: { texture: 12, grain: { ...DEFAULT_GRAIN, amount: 40, seed: 4242 }, glow: { ...DEFAULT_GLOW, amount: 30, style: 'diffusion' } } })
    const out = writeXmp(null, data({ develop: JSON.stringify(s) }))!
    const back = normalizeSettings(JSON.parse(readXmp(out).develop!))
    expect(back.effects).toEqual(s.effects)
    const broken = normalizeSettings({ ...DEFAULT_SETTINGS, effects: { texture: 'x', grain: { amount: 'y' }, vignette: 5 } } as never)
    expect(broken.effects).toBeUndefined()
  })

  it('Lightroom changing its Effects fields later is offered as a change and applied with Read changes', () => {
    const ours = { rating: 3, flag: 0, color: 0, keywords: [], metadata: EMPTY_METADATA, develop: JSON.stringify({ effects: { texture: 22 } }) }
    const base = fieldsFromRead(readXmp(LR_FX), FRAME)
    const later = fieldsFromRead(readXmp(LR_FX.replace('crs:Dehaze="+30"', 'crs:Dehaze="+55"')), FRAME)
    const p = mergeForRead(base, fieldsFromCatalog(ours, FRAME), later)
    expect(p.effects).toBe(lrFxKey(lrFxState([22, -14, 55, -35, 40, 10, 65, 20, 2, 25, 30, 60])))
    // Glow's fields aren't compared: a Glow change alone isn't a change here.
    const glowOnly = fieldsFromRead(readXmp(LR_FX.replace('crs:GlowRange="70"', 'crs:GlowRange="20"')), FRAME)
    expect(mergeForRead(base, fieldsFromCatalog(ours, FRAME), glowOnly).effects).toBeUndefined()
  })
})
