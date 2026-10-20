// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from './xmp'
import { masksFromLightroom } from './lightroomMasks'
import { acrName, isAcrFor } from './acr'
import { DEFAULT_SETTINGS, normalizeSettings } from '../engine/develop/settings'
import type { LocalMask } from '../engine/develop/masks'

// Masks in sidecars (PHASE3.md Part 23): LightBench's own masks travel in lightbench:Develop and come back exactly;
// damaged ones are ignored; Lightroom's crs: masks are read best-effort (experimental) and never written; a Lightroom
// .acr file next to the photo is noticed.

const masks: LocalMask[] = [
  {
    id: 'm1', name: 'Sky', invert: false, amount: 80, feather: 20, refine: 30,
    components: [
      { id: 'c1', op: 'add', invert: false, shape: { kind: 'linear', full: [0.5, 0.1], zero: [0.5, 0.45] } },
      { id: 'c2', op: 'subtract', invert: true, shape: { kind: 'radial', center: [0.3, 0.2], rx: 0.1, ry: 0.08, angle: 15, feather: 40 } },
      { id: 'c3', op: 'add', invert: false, shape: { kind: 'brush', strokes: [{ size: 0.02, feather: 50, flow: 60, density: 90, erase: true, dabs: [0.1, 0.2, 0.11, 0.2], pressure: [0.5, 0.7], pressureTo: 'size' }] } },
    ],
    adjust: { exposure: -0.7, highlights: -30, temperature: -12 },
  },
  { id: 'm2', name: 'Brights', invert: true, amount: 100, feather: 0, refine: 0, components: [{ id: 'c4', op: 'add', invert: false, shape: { kind: 'luminance', range: [50, 70, 100, 100] } }, { id: 'c5', op: 'intersect', invert: false, shape: { kind: 'colour', samples: [[0.62, -0.03, -0.09]], refine: 40 } }], adjust: { saturation: 25, vibrance: -10, contrast: 15 } },
]

const data = (develop: string | null): SidecarData => ({ rating: 0, flag: 0, color: 0, develop })

describe('LightBench’s masks in the sidecar', () => {
  it('round-trip through lightbench:Develop', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks })
    const xmp = writeXmp(null, data(JSON.stringify(s)))!
    expect(xmp).toContain('lightbench:Develop')
    expect(xmp).not.toContain('crs:MaskGroupBasedCorrections')
    const back = normalizeSettings(JSON.parse(readXmp(xmp).develop!))
    expect(back.masks).toEqual(s.masks)
    expect(back).toEqual(s)
  })

  it('ignore damaged masks safely, keeping the rest of the edit', () => {
    const broken = { ...DEFAULT_SETTINGS, exposure: 0.4, masks: [{ junk: true }, { components: [{ shape: { kind: 'radial', center: 'x' } }] }, masks[1]] }
    const xmp = writeXmp(null, data(JSON.stringify(broken)))!
    const back = normalizeSettings(JSON.parse(readXmp(xmp).develop!))
    expect(back.exposure).toBe(0.4)
    expect(back.masks?.map((m) => m.name)).toEqual(['Brights'])
    const none = normalizeSettings(JSON.parse(readXmp(writeXmp(null, data(JSON.stringify({ ...DEFAULT_SETTINGS, masks: 'oops' })))!).develop!))
    expect('masks' in none).toBe(false)
  })
})

// A SYNTHETIC sidecar, written here from ExifTool 3.79's field names (XMP.pm `%sCorrection`, `%sCorrectionMask`,
// `%sCorrRangeMask`) in the forms Adobe's XMP takes (struct fields as attributes, lists as rdf:Seq). It was NOT written
// by Lightroom: the values' meanings it encodes are the guesses lightroomMasks.ts documents.
const LR_SYNTHETIC = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:ProcessVersion="15.4">
   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:CorrectionActive="true" crs:CorrectionName="Sky" crs:LocalExposure2012="-0.25" crs:LocalHighlights2012="-0.4" crs:LocalClarity2012="0.2" crs:LocalSharpness="0.3">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li crs:What="Mask/Gradient" crs:MaskValue="1" crs:MaskBlendMode="0" crs:MaskInverted="false" crs:ZeroX="0.5" crs:ZeroY="0.5" crs:FullX="0.5" crs:FullY="0.1"/>
         <rdf:li crs:What="Mask/RangeMask" crs:MaskBlendMode="2">
          <crs:CorrectionRangeMask crs:Version="3" crs:Type="2" crs:LumRange="0.5 0.6 1 1"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
     <rdf:li rdf:parseType="Resource">
      <crs:What>Correction</crs:What>
      <crs:CorrectionAmount>0.5</crs:CorrectionAmount>
      <crs:CorrectionName>Face</crs:CorrectionName>
      <crs:LocalShadows2012>0.3</crs:LocalShadows2012>
      <crs:CorrectionMasks>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource">
         <crs:What>Mask/CircularGradient</crs:What>
         <crs:Top>0.2</crs:Top><crs:Left>0.3</crs:Left><crs:Bottom>0.6</crs:Bottom><crs:Right>0.5</crs:Right>
         <crs:Angle>0</crs:Angle><crs:Feather>60</crs:Feather><crs:Flipped>true</crs:Flipped>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <crs:What>Mask/Paint</crs:What>
         <crs:MaskBlendMode>1</crs:MaskBlendMode>
         <crs:Radius>0.01</crs:Radius><crs:Flow>0.5</crs:Flow><crs:CenterWeight>0.25</crs:CenterWeight><crs:MaskValue>1</crs:MaskValue>
         <crs:Dabs><rdf:Seq><rdf:li>d 0.400 0.400</rdf:li><rdf:li>d 0.410 0.405</rdf:li></rdf:Seq></crs:Dabs>
        </rdf:li>
        <rdf:li crs:What="Mask/Image" crs:MaskSubType="1"/>
       </rdf:Seq>
      </crs:CorrectionMasks>
     </rdf:li>
     <rdf:li crs:What="Correction" crs:CorrectionActive="false" crs:CorrectionName="Off">
      <crs:CorrectionMasks><rdf:Seq><rdf:li crs:What="Mask/Gradient" crs:ZeroX="0" crs:ZeroY="0" crs:FullX="1" crs:FullY="1"/></rdf:Seq></crs:CorrectionMasks>
     </rdf:li>
     <rdf:li crs:What="Correction" crs:CorrectionName="Range only" crs:LocalSaturation="-0.5">
      <crs:CorrectionMasks><rdf:Seq><rdf:li crs:What="Mask/RangeMask"><crs:CorrectionRangeMask crs:Type="2" crs:LumRange="0 0 0.3 0.4"/></rdf:li></rdf:Seq></crs:CorrectionMasks>
     </rdf:li>
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`

describe('Lightroom’s masks (experimental, read only; synthetic sidecar)', () => {
  const read = readXmp(LR_SYNTHETIC)
  const out = masksFromLightroom(read.lightroomMasks!, [6000, 4000])

  it('finds the corrections in the forms XMP allows (attributes, elements, parseType Resource)', () => {
    expect(read.lightroomMasks).toHaveLength(4)
  })

  it('reads gradients, brush dabs and luminance ranges, with the local sliders, as LightBench masks', () => {
    expect(out.masks.map((m) => m.name)).toEqual(['Sky', 'Face', 'Range only'])
    const [sky, face, range] = out.masks
    // Clarity (Part 25) is read now; Sharpness, which LightBench lacks in masks, is left out.
    expect(sky.adjust).toEqual({ exposure: -1, highlights: -40, clarity: 20 })
    expect(sky.components.map((c) => c.shape.kind)).toEqual(['linear'])
    expect(sky.components[0].shape).toEqual({ kind: 'linear', full: [0.5, 0.1], zero: [0.5, 0.5] })
    expect(face.amount).toBe(50)
    expect(face.adjust).toEqual({ shadows: 30 })
    expect(face.components.map((c) => [c.shape.kind, c.op, c.invert])).toEqual([['radial', 'add', false], ['brush', 'subtract', false]])
    const r = face.components[0].shape as { center: number[]; rx: number; ry: number; feather: number }
    expect(r.center).toEqual([0.4, 0.4])
    expect(r.rx).toBeCloseTo((0.1 * 6000) / 4000, 6)
    expect(r.ry).toBeCloseTo(0.2, 6)
    expect(r.feather).toBe(60)
    const b = face.components[1].shape as { strokes: { dabs: number[]; flow: number; feather: number }[] }
    expect(b.strokes[0].dabs).toEqual([0.4, 0.4, 0.41, 0.405])
    expect(b.strokes[0].flow).toBe(50)
    expect(b.strokes[0].feather).toBe(75)
    expect(range.components[0].shape).toEqual({ kind: 'luminance', range: [0, 0, 30, 40] })
    expect(out.masks.every((m) => m.id.startsWith('lr'))).toBe(true)
  })

  it('leaves out (and says so) a range intersected with a gradient, AI masks, sliders it lacks and inactive masks', () => {
    expect(out.notes.join('\n')).toMatch(/range part combined with a brush or gradient/)
    expect(out.notes.join('\n')).toMatch(/AI mask/)
    expect(out.notes.join('\n')).toMatch(/Sharpness, Noise/)
    expect(out.notes.join('\n')).toMatch(/Inactive/)
  })

  it('never writes crs: masks: a sidecar with Lightroom’s masks keeps them as they were', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks })
    const xmp = writeXmp(LR_SYNTHETIC, data(JSON.stringify(s)))!
    expect(readXmp(xmp).lightroomMasks).toEqual(read.lightroomMasks)
    expect(xmp.match(/MaskGroupBasedCorrections/g)).toHaveLength(2)
  })

  it('ignores a sidecar without masks, or with a damaged list', () => {
    expect(readXmp(writeXmp(null, data(null))!).lightroomMasks).toBeUndefined()
    const damaged = LR_SYNTHETIC.replace(/<rdf:Seq>\s*<rdf:li>\s*<rdf:Description crs:What="Correction"/, '<rdf:Seq><rdf:li>junk</rdf:li><rdf:li><rdf:Description crs:What="Correction"')
    expect(() => masksFromLightroom(readXmp(damaged).lightroomMasks ?? [], [3, 2])).not.toThrow()
  })
})

describe('Lightroom’s .acr sidecar', () => {
  it('is the photo’s name with .acr, in any case', () => {
    expect(acrName('DSC_0001.NEF')).toBe('DSC_0001.acr')
    expect(isAcrFor('DSC_0001.NEF', 'dsc_0001.ACR')).toBe(true)
    expect(isAcrFor('DSC_0001.NEF', 'DSC_0001.xmp')).toBe(false)
    expect(isAcrFor('DSC_0001.NEF', 'DSC_0002.acr')).toBe(false)
  })
})
