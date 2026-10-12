import { describe, expect, it } from 'vitest'
import compactCanon from '../../../lensfun/db/compact-canon.xml?raw'
import milSony from '../../../lensfun/db/mil-sony.xml?raw'
import milZeiss from '../../../lensfun/db/mil-zeiss.xml?raw'
import slrNikon from '../../../lensfun/db/slr-nikon.xml?raw'
import slrSamyang from '../../../lensfun/db/slr-samyang.xml?raw'
import slrSigma from '../../../lensfun/db/slr-sigma.xml?raw'
import {
  autoScale, cameraName, fuzzyWords, FuzzyMatcher, guessParameters, interpolateDistortion, interpolateTca, interpolateVignetting,
  lensfunAutoScale, lensfunSourcePoint, lensfunVignettingGain, lensfunWarp, lensName, lfInterpolate, LensfunDb, matchLensfun, sanitizeLens,
  type DbLens, type LensfunWarp,
} from './lensfun'
import { mlTexts, parseLensfunXml, realFocal, type LensfunData } from './lensfun-xml'

// Real entries from the pinned Lensfun database (web/lensfun/db, CC BY-SA 3.0).
const data: LensfunData = { source: { repo: '', commit: '', date: '', licence: '' }, mounts: [], cameras: [], lenses: [] }
for (const xml of [slrNikon, milSony, milZeiss, compactCanon, slrSigma, slrSamyang]) parseLensfunXml(xml, data)
const db = new LensfunDb(data)
const lens = (model: string) => {
  const l = db.lenses.find((x) => mlTexts(x.model)[0] === model)
  if (!l) throw new Error(`no ${model}`)
  return l
}
const camera = (model: string) => db.cameras.find((c) => mlTexts(c.model)[0] === model)!
const ALL = { distortion: true, tca: true, vignetting: true, distortionAmount: 1, vignettingAmount: 1 }

describe('reading the database', () => {
  it('keeps the lens fields and calibrations as Lensfun reads them', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    expect(l.model).toEqual(['Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF', 'en', 'Nikkor AF 28-105mm f/3.5-4.5D IF'])
    expect(l.mounts).toEqual(['Nikon F AF'])
    expect(l.crop).toBe(1)
    expect(l.aspect).toBe(1.5)
    expect(l.distortion!.model).toBe('ptlens')
    expect(l.distortion!.rows[0]).toEqual([28, 0, 0.03722205440784227, -0.10934523917506013, 0.07078237933099067])
    // database.cpp: without real-focal, ptlens estimates focal × (1 − a − b − c).
    expect(realFocal('ptlens', l.distortion!.rows[0])).toBeCloseTo(28 * (1 - 0.03722205440784227 + 0.10934523917506013 - 0.07078237933099067), 12)
    expect(l.tca!.rows[0]).toEqual([28, 1.0004427, 0.9999566, 0, 0, 0, 0])
    // "4:3" aspect ratios are divided out; a compact's own mount and crop factor.
    const g12 = lens('Canon PowerShot G12 & compatibles (Standard)')
    expect(g12.aspect).toBeCloseTo(4 / 3, 12)
    expect(g12.crop).toBe(4.63)
    expect(g12.distortion!.model).toBe('poly5')
  })

  it('reads cameras with their translations', () => {
    const d700 = camera('Nikon D700')
    expect(d700).toMatchObject({ maker: ['Nikon Corporation', 'en', 'Nikon'], mount: 'Nikon F AF', crop: 1 })
    expect(cameraName(d700)).toBe('Nikon D700')
  })
})

describe('fuzzy matching (auxfun.cpp lfFuzzyStrCmp)', () => {
  it('splits into sorted words by character class, skipping lone symbols and a lone f', () => {
    expect(fuzzyWords('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')).toEqual(['105', '28', '3.5', '4.5', 'af', 'd', 'if', 'mm', 'nikkor', 'nikon', 'zoom'])
    // A trailing ".0" is dropped; "F4" gives "4" (the lone F is skipped); "+" and "*" are kept.
    expect(fuzzyWords('Canon EF 50mm f/2.0')).toEqual(['2', '50', 'canon', 'ef', 'mm'])
    expect(fuzzyWords('E PZ 18-105mm F4 G OSS')).toEqual(['105', '18', '4', 'e', 'g', 'mm', 'oss', 'pz'])
    expect(fuzzyWords('Zeiss Planar T* 1,4/50')).toContain('*')
  })

  it('scores the share of matched words, all pattern words required', () => {
    const m = new FuzzyMatcher('E PZ 18-105mm F4 G OSS')
    expect(m.compare('E PZ 18-105mm f/4 G OSS')).toBe(100)
    // 6 pattern words in an 11-word name: 6 · 200 / 17 = 70 (integer division).
    expect(new FuzzyMatcher('28-105mm f/3.5-4.5D').compare('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')).toBe(70)
    expect(new FuzzyMatcher('28-105mm f/3.5-4.5D VR').compare('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')).toBe(0)
    // Lensfun's loose mode (not used by darktable) still scores the words found.
    expect(new FuzzyMatcher('28-105mm f/3.5-4.5D VR', false).compare('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')).toBe(Math.trunc((6 * 200) / 18))
  })

  it('guesses focal and aperture ranges from names (lens.cpp GuessParameters)', () => {
    const z = { minFocal: 0, maxFocal: 0, minAperture: 0, maxAperture: 0 }
    expect(guessParameters('28-105mm f/3.5-4.5D', z)).toEqual({ minFocal: 28, maxFocal: 105, minAperture: 3.5, maxAperture: 0 })
    expect(guessParameters('Canon EF 50mm f/1.8 STM', z)).toEqual({ minFocal: 50, maxFocal: 50, minAperture: 1.8, maxAperture: 0 })
    expect(guessParameters('Lens 1:2.8 70-200mm', z)).toEqual({ minFocal: 70, maxFocal: 200, minAperture: 2.8, maxAperture: 0 })
    expect(guessParameters('Kenko Teleplus 2x extender', z)).toEqual(z)
  })

  it('cuts exiv2-style alternatives off the lens name (darktable _lens_sanitize)', () => {
    expect(sanitizeLens('Sigma 18-35mm f/1.8 or Tamron X (B008)')).toBe('Sigma 18-35mm f/1.8')
    expect(sanitizeLens('E 25mm F2')).toBe('E 25mm F2')
  })
})

describe('matching cameras and lenses (database.cpp)', () => {
  it('finds the test files’ cameras from their EXIF names', () => {
    expect(cameraName(db.findCameras('NIKON CORPORATION', 'NIKON D700')[0].camera)).toBe('Nikon D700')
    expect(cameraName(db.findCameras('NIKON CORPORATION', 'NIKON D80')[0].camera)).toBe('Nikon D80')
    expect(cameraName(db.findCameras('NIKON CORPORATION', 'NIKON D5200')[0].camera)).toBe('Nikon D5200')
    expect(cameraName(db.findCameras('SONY', 'ILCE-6300')[0].camera)).toBe('Sony Alpha 6300')
    expect(cameraName(db.findCameras('SONY', 'ILCE-7M2')[0].camera)).toBe('Sony Alpha 7 II')
    expect(db.findCameras('NIKON CORPORATION', 'NIKON D7000')[0].camera).not.toBe(db.findCameras('NIKON CORPORATION', 'NIKON D700')[0].camera)
  })

  it('scores a lens as MatchScore does', () => {
    const cam = camera('Nikon D700')
    const r = db.findLenses(cam, null, '28-105mm f/3.5-4.5D')
    expect(mlTexts(r[0].lens.model)[0]).toBe('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    // Crop 1 on a crop-1 calibration: 5; min/max focal and min aperture equal: 3 × 10; same mount: 10; model: the
    // English name scores 6 · 200 / 15 = 80 words, × 4 / 10 = 32. Total 77.
    expect(r[0].score).toBe(77)
    // A different mount scores nothing.
    expect(db.findLenses(camera('ILCE-7M2'), null, '28-105mm f/3.5-4.5D').some((x) => x.lens === r[0].lens)).toBe(false)
  })

  it('matches the test files’ lenses (darktable reload_defaults)', () => {
    const m = (maker: string, model: string, l: string) => {
      const x = matchLensfun(db, { maker, model, lens: l })
      return x.lens ? mlTexts(x.lens.model)[0] : null
    }
    expect(m('NIKON CORPORATION', 'NIKON D700', '28-105mm f/3.5-4.5D')).toBe('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    expect(m('NIKON CORPORATION', 'NIKON D80', '18-200mm f/3.5-5.6G VR')).toBe('Nikon AF-S DX VR Zoom-Nikkor 18-200mm f/3.5-5.6G IF-ED')
    expect(m('SONY', 'ILCE-6300', 'E PZ 18-105mm F4 G OSS')).toBe('E PZ 18-105mm f/4 G OSS')
    expect(m('SONY', 'ILCE-7M2', 'E 25mm F2')).toBe('E 25mm f/2')
    // The D5200's kit lens; with Nikon's AF-P bit the AF-P version.
    expect(m('NIKON CORPORATION', 'NIKON D5200', '18-55mm f/3.5-5.6G VR')).toMatch(/18-55mm f\/3.5-5.6G VR/)
    expect(m('NIKON CORPORATION', 'NIKON D5200', 'AF-P 18-55mm f/3.5-5.6G VR')).toBe('Nikon AF-P DX Nikkor 18-55mm f/3.5-5.6G VR')
    // Without the camera in the database, darktable doesn't correct.
    expect(matchLensfun(db, { maker: 'NoSuch', model: 'Camera 1', lens: '28-105mm f/3.5-4.5D' })).toEqual({ camera: null, crop: 0, lens: null })
  })

  it('takes a picked camera and lens over the automatic ones', () => {
    const pickedLens = lens('Nikon AF-S DX Zoom-Nikkor 18-55mm f/3.5-5.6G VR')
    const x = matchLensfun(db, { maker: 'NIKON CORPORATION', model: 'NIKON D80', lens: '18-200mm f/3.5-5.6G VR' }, { lens: pickedLens })
    expect(x.lens).toBe(pickedLens)
    expect(cameraName(x.camera!)).toBe('Nikon D80')
  })
})

describe('interpolation (lens.cpp)', () => {
  it('Hermite spline of _lf_interpolate', () => {
    expect(lfInterpolate(0, 1, 2, 3, 0.5)).toBe(1.5)
    // Missing neighbours: the tangent is the chord.
    expect(lfInterpolate(null, 1, 3, null, 0.25)).toBeCloseTo(1.5, 12)
  })

  it('distortion between calibrated focal lengths, terms scaled by the focal length', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    const rows = Object.fromEntries(l.distortion!.rows.map((r) => [r[0], r]))
    // 30 mm lies between 28 (below) and 32 (above); 38 is the next above, nothing further below.
    const t = (30 - 32) / (28 - 32)
    const h = (y1: number | null, y2: number, y3: number, y4: number | null) => {
      const tg2 = y1 === null ? y3 - y2 : (y3 - y1) / 2
      const tg3 = y4 === null ? y3 - y2 : (y4 - y2) / 2
      return (2 * t ** 3 - 3 * t ** 2 + 1) * y2 + (t ** 3 - 2 * t ** 2 + t) * tg2 + (-2 * t ** 3 + 3 * t ** 2) * y3 + (t ** 3 - t ** 2) * tg3
    }
    const d = interpolateDistortion(l, 1, 30)!
    for (let i = 0; i < 3; i++) expect(d.terms[i]).toBeCloseTo(h(rows[38][2 + i] * 38, rows[32][2 + i] * 32, rows[28][2 + i] * 28, null) / 30, 12)
    expect(d.realFocal).toBeCloseTo(h(realFocal('ptlens', rows[38]), realFocal('ptlens', rows[32]), realFocal('ptlens', rows[28]), null), 12)
    // An exact focal length takes its row; beyond the last one, the nearest row.
    expect(interpolateDistortion(l, 1, 28)!.terms).toEqual(rows[28].slice(2))
    expect(interpolateDistortion(l, 1, 200)!.terms).toEqual(rows[105].slice(2))
    // A camera with a smaller crop factor than the calibration (crop / calib < 0.96) can't use it.
    expect(interpolateDistortion(lens('Nikon AF-S DX Zoom-Nikkor 18-55mm f/3.5-5.6G VR'), 1, 18)).toBeNull()
  })

  it('TCA: kr/vr and kb/vb unscaled, the other terms scaled by the focal length', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    const rows = Object.fromEntries(l.tca!.rows.map((r) => [r[0], r]))
    const t = (30 - 34) / (28 - 34)
    const y1 = rows[38][1], y2 = rows[34][1], y3 = rows[28][1]
    const tg2 = (y3 - y1) / 2
    const tg3 = y3 - y2
    const vr = (2 * t ** 3 - 3 * t ** 2 + 1) * y2 + (t ** 3 - 2 * t ** 2 + t) * tg2 + (-2 * t ** 3 + 3 * t ** 2) * y3 + (t ** 3 - t ** 2) * tg3
    expect(interpolateTca(l, 1, 30)!.terms[0]).toBeCloseTo(vr, 12)
  })

  it('vignetting by inverse distance weighting (power 3.5) over focal, 4/aperture and 0.1/distance', () => {
    const l = lens('E 25mm f/2') as DbLens
    const rows = l.vignetting!.rows
    // An exact calibration point is returned as it is.
    const exact = rows[0]
    expect(interpolateVignetting(l, 1, exact[0], exact[1], exact[2])).toEqual(exact.slice(3))
    // Between apertures: a prime lens has no focal axis (max = min).
    const aperture = 2.1
    const distance = 1000
    let w = 0
    const sum = [0, 0, 0]
    for (const r of rows) {
      const d = Math.hypot(4 / r[1] - 4 / aperture, 0.1 / r[2] - 0.1 / distance)
      const wi = 1 / d ** 3.5
      w += wi
      for (let i = 0; i < 3; i++) sum[i] += wi * r[3 + i]
    }
    const got = interpolateVignetting(l, 1, 25, aperture, distance)!
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(sum[i] / w, 10)
    // No aperture in the file: nothing is close enough.
    expect(interpolateVignetting(l, 1, 25, 0, distance)).toBeNull()
  })
})

/**
 * Reference for the correction, written from Lensfun's model definitions (the Hugin coordinates: r = 1 at half
 * the shorter side of the calibration sensor; lens.h): output pixel → source pixel. Lensfun keeps the focal length
 * of PT models by dividing the corrected radius by d (mod-coord.cpp, "Note about PT-based distortion models"), and
 * the automatic scale divides the corrected position first. Independent of lensfun.ts's normalised coordinates.
 */
function reference(l: DbLens, camCrop: number, w: number, h: number, model: string, t: number[], scale: number, x: number, y: number, tca?: { model: string; t: number[]; channel: 0 | 2 }) {
  const mmPerPx = Math.hypot(36, 24) / camCrop / Math.hypot(w, h)
  const unit = Math.hypot(36, 24) / l.crop / Math.hypot(l.aspect, 1) / 2 / mmPerPx
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const dx = (x - cx) / scale
  const dy = (y - cy) / scale
  const d = model === 'ptlens' ? 1 - t[0] - t[1] - t[2] : model === 'poly3' ? 1 - t[0] : 1
  const r = Math.hypot(dx, dy) / unit / d
  const rd = model === 'ptlens' ? r * (t[0] * r ** 3 + t[1] * r ** 2 + t[2] * r + d) : model === 'poly3' ? r * (1 - t[0] + t[0] * r ** 2) : r * (1 + t[0] * r ** 2 + t[1] * r ** 4)
  let f = (rd * unit) / Math.hypot(dx, dy)
  if (tca) {
    const rh = rd // distorted radius, Hugin units
    if (tca.model === 'linear') f *= tca.channel === 0 ? tca.t[0] : tca.t[1]
    else {
      const [v, c, b] = tca.channel === 0 ? [tca.t[0], tca.t[2], tca.t[4]] : [tca.t[1], tca.t[3], tca.t[5]]
      f *= b * rh ** 2 + c * rh + v
    }
  }
  return [cx + dx * f, cy + dy * f]
}

describe('the correction against Lensfun’s model definitions', () => {
  const points = [[0, 0], [4283, 0], [100, 2000], [2141.5, 0], [3000, 2843], [1000, 900]]

  it('ptlens (Nikkor 28-105 at 28 mm on a D700, 4284 × 2844)', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    const w = lensfunWarp(l, { crop: 1, focal: 28, aperture: 8, distance: 1000 }, 4284, 2844, { ...ALL, tca: false })!
    const t = l.distortion!.rows[0].slice(2)
    for (const [x, y] of points) {
      const [ex, ey] = reference(l, 1, 4284, 2844, 'ptlens', t, 1 / w.scale, x, y)
      const [gx, gy] = lensfunSourcePoint(w, x, y)
      expect(Math.abs(gx - ex) + Math.abs(gy - ey)).toBeLessThan(1e-6)
    }
  })

  it('poly3 with linear TCA (made-up coefficients; the database’s poly3 + linear lenses have k1 = 0, kr = kb = 1)', () => {
    const l = new LensfunDb({
      source: data.source, mounts: [], cameras: [],
      lenses: [{ maker: 'Test', model: 'Test 35mm f/2', mounts: ['Nikon F AF'], crop: 1.528, aspect: 1.5, type: 'rectilinear', minFocal: 0, maxFocal: 0, minAperture: 0, maxAperture: 0,
        distortion: { model: 'poly3', rows: [[35, 0, -0.021]] }, tca: { model: 'linear', rows: [[35, 1.0004, 0.9997]] } }],
    }).lenses[0]
    const w = lensfunWarp(l, { crop: 1.534, focal: 35, aperture: 2, distance: 1000 }, 6000, 4000, ALL)!
    const t = l.distortion!.rows[0].slice(2)
    for (const [x, y] of points) {
      for (const channel of [0, 1, 2] as const) {
        const tca = channel === 1 ? undefined : { model: 'linear', t: l.tca!.rows[0].slice(1), channel }
        const [ex, ey] = reference(l, 1.534, 6000, 4000, 'poly3', t, 1 / w.scale, x, y, tca)
        const [gx, gy] = lensfunSourcePoint(w, x, y, channel)
        expect(Math.abs(gx - ex) + Math.abs(gy - ey)).toBeLessThan(1e-6)
      }
    }
  })

  it('poly5 (Canon PowerShot G12, 4:3 calibration)', () => {
    const l = lens('Canon PowerShot G12 & compatibles (Standard)')
    const focal = l.distortion!.rows[0][0]
    const w = lensfunWarp(l, { crop: 4.63, focal, aperture: 4, distance: 1000 }, 3648, 2736, { ...ALL, tca: false, vignetting: false })!
    const t = l.distortion!.rows[0].slice(2)
    for (const [x, y] of [[0, 0], [3647, 2735], [1823.5, 0], [500, 600]]) {
      const [ex, ey] = reference(l, 4.63, 3648, 2736, 'poly5', t, 1 / w.scale, x, y)
      const [gx, gy] = lensfunSourcePoint(w, x, y)
      expect(Math.abs(gx - ex) + Math.abs(gy - ey)).toBeLessThan(1e-6)
    }
  })

  it('poly3 TCA (Nikkor 28-105 at 28 mm)', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    const w = lensfunWarp(l, { crop: 1, focal: 28, aperture: 8, distance: 1000 }, 4284, 2844, ALL)!
    const t = l.distortion!.rows[0].slice(2)
    for (const [x, y] of points) {
      for (const channel of [0, 2] as const) {
        const [ex, ey] = reference(l, 1, 4284, 2844, 'ptlens', t, 1 / w.scale, x, y, { model: 'poly3', t: l.tca!.rows[0].slice(1), channel })
        const [gx, gy] = lensfunSourcePoint(w, x, y, channel)
        expect(Math.abs(gx - ex) + Math.abs(gy - ey)).toBeLessThan(1e-6)
      }
    }
  })

  it('vignetting pa: r = 1 at the corner of the calibration sensor', () => {
    const l = lens('E 25mm f/2')
    const row = l.vignetting!.rows[0]
    const w = lensfunWarp(l, { crop: 1, focal: row[0], aperture: row[1], distance: row[2] }, 6024, 4024, ALL)!
    const mmPerPx = Math.hypot(36, 24) / Math.hypot(6024, 4024)
    const unit = Math.hypot(36, 24) / l.crop / 2 / mmPerPx
    for (const [x, y] of [[0, 0], [3011.5, 2011.5], [6023, 100]]) {
      const r = Math.hypot(x - 3011.5, y - 2011.5) / unit
      const c = 1 + row[3] * r ** 2 + row[4] * r ** 4 + row[5] * r ** 6
      expect(lensfunVignettingGain(w, x, y)).toBeCloseTo(1 / c, 9)
    }
    // Half the amount: halfway between no correction and the profile's falloff.
    const half = lensfunWarp(l, { crop: 1, focal: row[0], aperture: row[1], distance: row[2] }, 6024, 4024, { ...ALL, vignettingAmount: 0.5 })!
    const r = Math.hypot(3011.5, 2011.5) / unit
    expect(lensfunVignettingGain(half, 0, 0)).toBeCloseTo(1 / (1 + 0.5 * (row[3] * r ** 2 + row[4] * r ** 4 + row[5] * r ** 6)), 9)
  })

  it('the distortion amount blends the radial factor (0 = no distortion correction)', () => {
    const l = lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF')
    const off = lensfunWarp(l, { crop: 1, focal: 28, aperture: 8, distance: 1000 }, 4284, 2844, { ...ALL, tca: false, vignetting: false, distortionAmount: 0 })
    expect(off).toBeNull()
    const w = lensfunWarp(l, { crop: 1, focal: 28, aperture: 8, distance: 1000 }, 4284, 2844, { ...ALL, tca: false, distortionAmount: 0.5 })!
    expect(w.distortion!.amount).toBe(0.5)
  })
})

describe('the automatic scale (GetAutoScale)', () => {
  const inside = (w: LensfunWarp) => {
    let worst = -Infinity
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      for (const [x, y] of [[t * (w.width - 1), 0], [t * (w.width - 1), w.height - 1], [0, t * (w.height - 1)], [w.width - 1, t * (w.height - 1)]]) {
        for (const c of [0, 1, 2] as const) {
          const [sx, sy] = lensfunSourcePoint(w, x, y, c)
          worst = Math.max(worst, -sx, sx - (w.width - 1), -sy, sy - (w.height - 1))
        }
      }
    }
    return worst
  }

  it('fills the frame: the border maps inside the photo, touching its edge', () => {
    for (const [model, camCrop, focal, w, h] of [
      ['Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF', 1, 28, 4284, 2844],
      ['Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF', 1, 85, 4284, 2844],
      ['Nikon AF-S DX VR Zoom-Nikkor 18-200mm f/3.5-5.6G IF-ED', 1.523, 18, 3900, 2613],
      ['E PZ 18-105mm f/4 G OSS', 1.534, 97, 6024, 4024],
      ['E 25mm f/2', 1, 25, 6024, 4024],
    ] as const) {
      const warp = lensfunWarp(lens(model), { crop: camCrop, focal, aperture: 8, distance: 1000 }, w, h, ALL)!
      const worst = inside(warp)
      expect(worst, `${model} at ${focal} mm`).toBeLessThanOrEqual(1e-6)
      // Not enlarged more than needed: within 0.2 % (Lensfun's 1.001 margins) of touching.
      expect(worst, `${model} at ${focal} mm`).toBeGreaterThan(-0.003 * Math.hypot(w, h) / 2)
    }
  })

  it('is Lensfun’s own scale or larger; Lensfun’s tolerance leaves the corners of the A6300 file outside', () => {
    const warp = lensfunWarp(lens('E PZ 18-105mm f/4 G OSS'), { crop: 1.534, focal: 97, aperture: 8, distance: 1000 }, 6024, 4024, ALL)!
    const ours = autoScale({ ...warp, scale: 1 })
    const theirs = lensfunAutoScale({ ...warp, scale: 1 })
    expect(ours).toBeGreaterThan(theirs)
    const corner = lensfunSourcePoint({ ...warp, scale: 1 / theirs }, 0, 0)
    expect(corner[0]).toBeLessThan(-5)
  })
})

it('names lenses as Lensfun shows them in English', () => {
  expect(lensName(lens('Nikon AF Zoom-Nikkor 28-105mm f/3.5-4.5D IF'))).toBe('Nikkor AF 28-105mm f/3.5-4.5D IF')
})
