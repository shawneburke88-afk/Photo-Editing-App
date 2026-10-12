// LSD, the Line Segment Detector, as darktable's "rotate and perspective" module (ashift) uses it to find the
// straight lines of a photo.
//
// Translated to TypeScript for LightBench (2026) from darktable's src/iop/ashift_lsd.c:
//
//   This file is part of darktable,
//   Copyright (C) 2016-2025 darktable developers.
//   darktable is free software: you can redistribute it and/or modify it under the terms of the GNU General
//   Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
//   option) any later version.
//
// which contains LSD version 1.6 (downloaded by darktable on January 30, 2016), published with
//
//   "LSD: a Line Segment Detector" by Rafael Grompone von Gioi, Jeremie Jakubowicz, Jean-Michel Morel, and
//   Gregory Randall, Image Processing On Line, 2012. DOI:10.5201/ipol.2012.gjmr-lsd
//   http://dx.doi.org/10.5201/ipol.2012.gjmr-lsd
//
//   Copyright (c) 2007-2011 rafael grompone von gioi <grompone@gmail.com>
//
//   This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero
//   General Public License as published by the Free Software Foundation, either version 3 of the License, or (at
//   your option) any later version.
//
//   This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
//   implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public
//   License for more details.
//
// Licence note: this file therefore carries LSD's AGPL-3.0-or-later terms along with darktable's GPL-3.0-or-later
// ones (GPL-3.0 section 13 allows the combination; see THIRD_PARTY_NOTICES.md).
//
// Changes in the translation: typed arrays instead of the C image structures; the pixel list ordered by gradient
// is kept as bins of index chains (same order as the C linked lists); the rectangle iterator calls a function per
// pixel; parameter checks that would abort the C program are dropped (inputs here are always valid); the region
// image output (unused by darktable) is left out. The numerical steps, constants and their order are unchanged.

const NOTDEF = -1024.0
const M_3_2_PI = (Math.PI * 3.0) / 2.0
const M_2__PI = 2.0 * Math.PI
const RELATIVE_ERROR_FACTOR = 100.0
const DBL_EPSILON = 2.220446049250313e-16
const DBL_MIN = 2.2250738585072014e-308

/** A detected segment: endpoints, width, angle precision p and −log10(NFA), as LSD's 7-tuples. */
export interface LsdSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  p: number
  logNfa: number
}

interface Img {
  w: number
  h: number
  data: Float64Array
}

function doubleEqual(a: number, b: number): boolean {
  if (a === b) return true
  const absDiff = Math.abs(a - b)
  let absMax = Math.max(Math.abs(a), Math.abs(b))
  if (absMax < DBL_MIN) absMax = DBL_MIN
  return absDiff / absMax <= RELATIVE_ERROR_FACTOR * DBL_EPSILON
}

const dist = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1))

// ---- Gaussian sub-sampling

function gaussianKernel(kernel: Float64Array, sigma: number, mean: number) {
  let sum = 0
  for (let i = 0; i < kernel.length; i++) {
    const val = (i - mean) / sigma
    kernel[i] = Math.exp(-0.5 * val * val)
    sum += kernel[i]
  }
  if (sum >= 0) for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
}

function gaussianSampler(input: Img, scale: number, sigmaScale: number): Img {
  const N = Math.ceil(input.w * scale)
  const M = Math.ceil(input.h * scale)
  const aux = new Float64Array(N * input.h)
  const out = new Float64Array(N * M)
  const sigma = scale < 1.0 ? sigmaScale / scale : sigmaScale
  const prec = 3.0
  const h = Math.ceil(sigma * Math.sqrt(2.0 * prec * Math.log(10.0)))
  const n = 1 + 2 * h
  const kernel = new Float64Array(n)
  const dx = 2 * input.w
  const dy = 2 * input.h
  // First subsampling: x axis
  for (let x = 0; x < N; x++) {
    const xx = x / scale
    const xc = Math.floor(xx + 0.5)
    gaussianKernel(kernel, sigma, h + xx - xc)
    for (let y = 0; y < input.h; y++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        let j = xc - h + i
        while (j < 0) j += dx
        while (j >= dx) j -= dx
        if (j >= input.w) j = dx - 1 - j
        sum += input.data[j + y * input.w] * kernel[i]
      }
      aux[x + y * N] = sum
    }
  }
  // Second subsampling: y axis
  for (let y = 0; y < M; y++) {
    const yy = y / scale
    const yc = Math.floor(yy + 0.5)
    gaussianKernel(kernel, sigma, h + yy - yc)
    for (let x = 0; x < N; x++) {
      let sum = 0
      for (let i = 0; i < n; i++) {
        let j = yc - h + i
        while (j < 0) j += dy
        while (j >= dy) j -= dy
        if (j >= input.h) j = dy - 1 - j
        sum += aux[x + j * N] * kernel[i]
      }
      out[x + y * N] = sum
    }
  }
  return { w: N, h: M, data: out }
}

// ---- gradient

/** Level-line angles (NOTDEF where the gradient is too small), gradient norms, and pixels by decreasing norm. */
function llAngle(input: Img, threshold: number, nBins: number): { angles: Img; modgrad: Img; order: Int32Array } {
  const p = input.w
  const n = input.h
  const g = new Float64Array(p * n)
  const mod = new Float64Array(p * n)
  let maxGrad = 0
  for (let x = 0; x < p; x++) g[(n - 1) * p + x] = NOTDEF
  for (let y = 0; y < n; y++) g[p * y + p - 1] = NOTDEF
  const d = input.data
  for (let x = 0; x < p - 1; x++) {
    for (let y = 0; y < n - 1; y++) {
      const adr = y * p + x
      const com1 = d[adr + p + 1] - d[adr]
      const com2 = d[adr + 1] - d[adr + p]
      const gx = com1 + com2
      const gy = com1 - com2
      const norm = Math.sqrt((gx * gx + gy * gy) / 4.0)
      mod[adr] = norm
      if (norm <= threshold) g[adr] = NOTDEF
      else {
        g[adr] = Math.atan2(gx, -gy)
        if (norm > maxGrad) maxGrad = norm
      }
    }
  }
  // Pseudo-ordering by gradient: bins of linked indices, filled x-major as in the C code, read from the top bin.
  const start = new Int32Array(nBins).fill(-1)
  const end = new Int32Array(nBins).fill(-1)
  const next = new Int32Array(p * n).fill(-1)
  let count = 0
  for (let x = 0; x < p - 1; x++) {
    for (let y = 0; y < n - 1; y++) {
      const adr = y * p + x
      let i = Math.floor((mod[adr] * nBins) / maxGrad)
      if (!(i < nBins)) i = nBins - 1
      if (!(i >= 0)) i = 0
      if (end[i] < 0) start[i] = adr
      else next[end[i]] = adr
      end[i] = adr
      count++
    }
  }
  const order = new Int32Array(count)
  let k = 0
  for (let i = nBins - 1; i >= 0; i--) for (let a = start[i]; a >= 0; a = next[a]) order[k++] = a
  return { angles: { w: p, h: n, data: g }, modgrad: { w: p, h: n, data: mod }, order }
}

function isAligned(x: number, y: number, angles: Img, theta: number, prec: number): boolean {
  const a = angles.data[x + y * angles.w]
  if (a === NOTDEF) return false
  theta -= a
  if (theta < 0) theta = -theta
  if (theta > M_3_2_PI) {
    theta -= M_2__PI
    if (theta < 0) theta = -theta
  }
  return theta <= prec
}

function angleDiff(a: number, b: number): number {
  a -= b
  while (a <= -Math.PI) a += M_2__PI
  while (a > Math.PI) a -= M_2__PI
  return a < 0 ? -a : a
}

function angleDiffSigned(a: number, b: number): number {
  a -= b
  while (a <= -Math.PI) a += M_2__PI
  while (a > Math.PI) a -= M_2__PI
  return a
}

// ---- NFA

function logGammaLanczos(x: number): number {
  const q = [75122.633153, 80916.6278952, 36308.2951477, 8687.24529705, 1168.92649479, 83.8676043424, 2.50662827511]
  let a = (x + 0.5) * Math.log(x + 5.5) - (x + 5.5)
  let b = 0
  for (let n = 0; n < 7; n++) {
    a -= Math.log(x + n)
    b += q[n] * Math.pow(x, n)
  }
  return a + Math.log(b)
}

const logGammaWindschitl = (x: number) =>
  0.918938533204673 + (x - 0.5) * Math.log(x) - x + 0.5 * x * Math.log(x * Math.sinh(1 / x) + 1 / (810.0 * Math.pow(x, 6.0)))

const logGamma = (x: number) => (x > 15.0 ? logGammaWindschitl(x) : logGammaLanczos(x))

function nfa(n: number, k: number, p: number, logNT: number): number {
  const tolerance = 0.1
  if (n === 0 || k === 0) return -logNT
  if (n === k) return -logNT - n * Math.log10(p)
  const pTerm = p / (1.0 - p)
  const log1term = logGamma(n + 1.0) - logGamma(k + 1.0) - logGamma(n - k + 1.0) + k * Math.log(p) + (n - k) * Math.log(1.0 - p)
  let term = Math.exp(log1term)
  if (doubleEqual(term, 0.0)) {
    if (k > n * p) return -log1term / Math.LN10 - logNT
    return -logNT
  }
  let binTail = term
  for (let i = k + 1; i <= n; i++) {
    const binTerm = (n - i + 1) * (1.0 / i)
    const multTerm = binTerm * pTerm
    term *= multTerm
    binTail += term
    if (binTerm < 1.0) {
      const err = term * ((1.0 - Math.pow(multTerm, n - i + 1)) / (1.0 - multTerm) - 1.0)
      if (err < tolerance * Math.abs(-Math.log10(binTail) - logNT) * binTail) break
    }
  }
  return -Math.log10(binTail) - logNT
}

// ---- rectangles

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  x: number
  y: number
  theta: number
  dx: number
  dy: number
  prec: number
  p: number
}

function interLow(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (doubleEqual(x1, x2) && y1 < y2) return y1
  if (doubleEqual(x1, x2) && y1 > y2) return y2
  return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
}

function interHi(x: number, x1: number, y1: number, x2: number, y2: number): number {
  if (doubleEqual(x1, x2) && y1 < y2) return y2
  if (doubleEqual(x1, x2) && y1 > y2) return y1
  return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1)
}

/** Calls `fn` for every integer pixel inside the rectangle, column by column (LSD's rect_iter). */
function forEachInRect(r: Rect, fn: (x: number, y: number) => void) {
  const vx0 = [r.x1 - (r.dy * r.width) / 2.0, r.x2 - (r.dy * r.width) / 2.0, r.x2 + (r.dy * r.width) / 2.0, r.x1 + (r.dy * r.width) / 2.0]
  const vy0 = [r.y1 + (r.dx * r.width) / 2.0, r.y2 + (r.dx * r.width) / 2.0, r.y2 - (r.dx * r.width) / 2.0, r.y1 - (r.dx * r.width) / 2.0]
  let offset: number
  if (r.x1 < r.x2 && r.y1 <= r.y2) offset = 0
  else if (r.x1 >= r.x2 && r.y1 < r.y2) offset = 1
  else if (r.x1 > r.x2 && r.y1 >= r.y2) offset = 2
  else offset = 3
  const vx = [0, 0, 0, 0]
  const vy = [0, 0, 0, 0]
  for (let n = 0; n < 4; n++) {
    vx[n] = vx0[(offset + n) % 4]
    vy[n] = vy0[(offset + n) % 4]
  }
  let x = Math.ceil(vx[0]) - 1
  let y = Math.ceil(vy[0])
  let ys = -Number.MAX_VALUE
  let ye = -Number.MAX_VALUE
  const end = () => x > vx[2]
  const inc = () => {
    if (!end()) y++
    while (y > ye && !end()) {
      x++
      if (end()) return
      ys = x < vx[3] ? interLow(x, vx[0], vy[0], vx[3], vy[3]) : interLow(x, vx[3], vy[3], vx[2], vy[2])
      ye = x < vx[1] ? interHi(x, vx[0], vy[0], vx[1], vy[1]) : interHi(x, vx[1], vy[1], vx[2], vy[2])
      y = Math.ceil(ys)
    }
  }
  inc()
  // Bounded for safety against non-finite rectangles (never reached on valid input).
  for (let guard = 0; !end() && guard < 1e8; guard++) {
    fn(x, y)
    inc()
  }
}

function rectNfa(rec: Rect, angles: Img, logNT: number): number {
  let pts = 0
  let alg = 0
  forEachInRect(rec, (x, y) => {
    if (x >= 0 && y >= 0 && x < angles.w && y < angles.h) {
      ++pts
      if (isAligned(x, y, angles, rec.theta, rec.prec)) ++alg
    }
  })
  return nfa(pts, alg, rec.p, logNT)
}

// ---- regions

interface Region {
  xs: Int32Array
  ys: Int32Array
  size: number
  angle: number
}

function getTheta(reg: Region, x: number, y: number, modgrad: Img, regAngle: number, prec: number): number {
  let Ixx = 0
  let Iyy = 0
  let Ixy = 0
  for (let i = 0; i < reg.size; i++) {
    const weight = modgrad.data[reg.xs[i] + reg.ys[i] * modgrad.w]
    Ixx += (reg.ys[i] - y) * (reg.ys[i] - y) * weight
    Iyy += (reg.xs[i] - x) * (reg.xs[i] - x) * weight
    Ixy -= (reg.xs[i] - x) * (reg.ys[i] - y) * weight
  }
  const lambda = 0.5 * (Ixx + Iyy - Math.sqrt((Ixx - Iyy) * (Ixx - Iyy) + 4.0 * Ixy * Ixy))
  let theta = Math.abs(Ixx) > Math.abs(Iyy) ? Math.atan2(lambda - Ixx, Ixy) : Math.atan2(Ixy, lambda - Iyy)
  if (angleDiff(theta, regAngle) > prec) theta += Math.PI
  return theta
}

function region2rect(reg: Region, modgrad: Img, regAngle: number, prec: number, p: number): Rect {
  let x = 0
  let y = 0
  let sum = 0
  for (let i = 0; i < reg.size; i++) {
    const weight = modgrad.data[reg.xs[i] + reg.ys[i] * modgrad.w]
    x += reg.xs[i] * weight
    y += reg.ys[i] * weight
    sum += weight
  }
  x /= sum
  y /= sum
  const theta = getTheta(reg, x, y, modgrad, regAngle, prec)
  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  let lMin = 0
  let lMax = 0
  let wMin = 0
  let wMax = 0
  for (let i = 0; i < reg.size; i++) {
    const l = (reg.xs[i] - x) * dx + (reg.ys[i] - y) * dy
    const w = -(reg.xs[i] - x) * dy + (reg.ys[i] - y) * dx
    if (l > lMax) lMax = l
    if (l < lMin) lMin = l
    if (w > wMax) wMax = w
    if (w < wMin) wMin = w
  }
  const rec: Rect = {
    x1: x + lMin * dx,
    y1: y + lMin * dy,
    x2: x + lMax * dx,
    y2: y + lMax * dy,
    width: wMax - wMin,
    x,
    y,
    theta,
    dx,
    dy,
    prec,
    p,
  }
  if (rec.width < 1.0) rec.width = 1.0
  return rec
}

function regionGrow(x: number, y: number, angles: Img, reg: Region, used: Uint8Array, prec: number) {
  reg.xs[0] = x
  reg.ys[0] = y
  reg.size = 1
  reg.angle = angles.data[x + y * angles.w]
  let sumdx = Math.cos(reg.angle)
  let sumdy = Math.sin(reg.angle)
  used[x + y * angles.w] = 1
  for (let i = 0; i < reg.size; i++) {
    for (let xx = reg.xs[i] - 1; xx <= reg.xs[i] + 1; xx++) {
      for (let yy = reg.ys[i] - 1; yy <= reg.ys[i] + 1; yy++) {
        if (xx >= 0 && yy >= 0 && xx < angles.w && yy < angles.h && used[xx + yy * angles.w] !== 1 && isAligned(xx, yy, angles, reg.angle, prec)) {
          used[xx + yy * angles.w] = 1
          reg.xs[reg.size] = xx
          reg.ys[reg.size] = yy
          ++reg.size
          sumdx += Math.cos(angles.data[xx + yy * angles.w])
          sumdy += Math.sin(angles.data[xx + yy * angles.w])
          reg.angle = Math.atan2(sumdy, sumdx)
        }
      }
    }
  }
}

const copyRect = (r: Rect): Rect => ({ ...r })

function rectImprove(rec: Rect, angles: Img, logNT: number, logEps: number): { rec: Rect; logNfa: number } {
  const delta = 0.5
  const delta2 = delta / 2.0
  let logNfa = rectNfa(rec, angles, logNT)
  if (logNfa > logEps) return { rec, logNfa }
  // try finer precisions
  let r = copyRect(rec)
  for (let n = 0; n < 5; n++) {
    r.p /= 2.0
    r.prec = r.p * Math.PI
    const v = rectNfa(r, angles, logNT)
    if (v > logNfa) {
      logNfa = v
      rec = copyRect(r)
    }
  }
  if (logNfa > logEps) return { rec, logNfa }
  // try to reduce width
  r = copyRect(rec)
  for (let n = 0; n < 5; n++) {
    if (r.width - delta >= 0.5) {
      r.width -= delta
      const v = rectNfa(r, angles, logNT)
      if (v > logNfa) {
        rec = copyRect(r)
        logNfa = v
      }
    }
  }
  if (logNfa > logEps) return { rec, logNfa }
  // try to reduce one side of the rectangle
  r = copyRect(rec)
  for (let n = 0; n < 5; n++) {
    if (r.width - delta >= 0.5) {
      r.x1 += -r.dy * delta2
      r.y1 += r.dx * delta2
      r.x2 += -r.dy * delta2
      r.y2 += r.dx * delta2
      r.width -= delta
      const v = rectNfa(r, angles, logNT)
      if (v > logNfa) {
        rec = copyRect(r)
        logNfa = v
      }
    }
  }
  if (logNfa > logEps) return { rec, logNfa }
  // try to reduce the other side of the rectangle
  r = copyRect(rec)
  for (let n = 0; n < 5; n++) {
    if (r.width - delta >= 0.5) {
      r.x1 -= -r.dy * delta2
      r.y1 -= r.dx * delta2
      r.x2 -= -r.dy * delta2
      r.y2 -= r.dx * delta2
      r.width -= delta
      const v = rectNfa(r, angles, logNT)
      if (v > logNfa) {
        rec = copyRect(r)
        logNfa = v
      }
    }
  }
  if (logNfa > logEps) return { rec, logNfa }
  // try even finer precisions
  r = copyRect(rec)
  for (let n = 0; n < 5; n++) {
    r.p /= 2.0
    r.prec = r.p * Math.PI
    const v = rectNfa(r, angles, logNT)
    if (v > logNfa) {
      logNfa = v
      rec = copyRect(r)
    }
  }
  return { rec, logNfa }
}

function reduceRegionRadius(reg: Region, modgrad: Img, regAngle: number, prec: number, p: number, rec: { r: Rect }, used: Uint8Array, angles: Img, densityTh: number): boolean {
  let density = reg.size / (dist(rec.r.x1, rec.r.y1, rec.r.x2, rec.r.y2) * rec.r.width)
  if (density >= densityTh) return true
  const xc = reg.xs[0]
  const yc = reg.ys[0]
  const rad1 = dist(xc, yc, rec.r.x1, rec.r.y1)
  const rad2 = dist(xc, yc, rec.r.x2, rec.r.y2)
  let rad = rad1 > rad2 ? rad1 : rad2
  while (density < densityTh) {
    rad *= 0.75
    for (let i = 0; i < reg.size; i++) {
      if (dist(xc, yc, reg.xs[i], reg.ys[i]) > rad) {
        used[reg.xs[i] + reg.ys[i] * angles.w] = 0
        reg.xs[i] = reg.xs[reg.size - 1]
        reg.ys[i] = reg.ys[reg.size - 1]
        --reg.size
        --i
      }
    }
    if (reg.size < 2) return false
    rec.r = region2rect(reg, modgrad, regAngle, prec, p)
    density = reg.size / (dist(rec.r.x1, rec.r.y1, rec.r.x2, rec.r.y2) * rec.r.width)
  }
  return true
}

// (The C version also takes the region's angle; region_grow below replaces it, so it is left out here.)
function refine(reg: Region, modgrad: Img, prec: number, p: number, rec: { r: Rect }, used: Uint8Array, angles: Img, densityTh: number): boolean {
  let density = reg.size / (dist(rec.r.x1, rec.r.y1, rec.r.x2, rec.r.y2) * rec.r.width)
  if (density >= densityTh) return true
  // First try: reduce angle tolerance
  const xc = reg.xs[0]
  const yc = reg.ys[0]
  const angC = angles.data[reg.xs[0] + reg.ys[0] * angles.w]
  let sum = 0
  let sSum = 0
  let n = 0
  for (let i = 0; i < reg.size; i++) {
    used[reg.xs[i] + reg.ys[i] * angles.w] = 0
    if (dist(xc, yc, reg.xs[i], reg.ys[i]) < rec.r.width) {
      const angD = angleDiffSigned(angles.data[reg.xs[i] + reg.ys[i] * angles.w], angC)
      sum += angD
      sSum += angD * angD
      ++n
    }
  }
  if (n === 0) return false
  const meanAngle = sum / n
  const tau = 2.0 * Math.sqrt((sSum - 2.0 * meanAngle * sum) / n + meanAngle * meanAngle)
  regionGrow(reg.xs[0], reg.ys[0], angles, reg, used, tau)
  if (reg.size < 2) return false
  rec.r = region2rect(reg, modgrad, reg.angle, prec, p)
  density = reg.size / (dist(rec.r.x1, rec.r.y1, rec.r.x2, rec.r.y2) * rec.r.width)
  // Second try: reduce region radius
  if (density < densityTh) return reduceRegionRadius(reg, modgrad, reg.angle, prec, p, rec, used, angles, densityTh)
  return true
}

// ---- the detector

/** LSD's `LineSegmentDetection`, with darktable's parameters passed by the caller (ashift.c, LSD_*). */
export function lineSegmentDetection(
  img: Float64Array,
  X: number,
  Y: number,
  scale: number,
  sigmaScale: number,
  quant: number,
  angTh: number,
  logEps: number,
  densityTh: number,
  nBins: number,
): LsdSegment[] {
  const out: LsdSegment[] = []
  const prec = (angTh * Math.PI) / 180
  const p = angTh / 180.0
  const rho = quant / Math.sin(prec)
  const image: Img = { w: X, h: Y, data: img }
  const { angles, modgrad, order } = llAngle(scale !== 1.0 ? gaussianSampler(image, scale, sigmaScale) : image, rho, nBins)
  const xsize = angles.w
  const ysize = angles.h
  const logNT = (5.0 * (Math.log10(xsize) + Math.log10(ysize))) / 2.0 + Math.log10(11.0)
  const minRegSize = Math.trunc(-logNT / Math.log10(p))
  const used = new Uint8Array(xsize * ysize)
  const reg: Region = { xs: new Int32Array(xsize * ysize), ys: new Int32Array(xsize * ysize), size: 0, angle: 0 }
  for (let k = 0; k < order.length; k++) {
    const adr = order[k]
    if (used[adr] !== 0 || angles.data[adr] === NOTDEF) continue
    regionGrow(adr % xsize, Math.floor(adr / xsize), angles, reg, used, prec)
    if (reg.size < minRegSize) continue
    const rec = { r: region2rect(reg, modgrad, reg.angle, prec, p) }
    if (!refine(reg, modgrad, prec, p, rec, used, angles, densityTh)) continue
    const improved = rectImprove(rec.r, angles, logNT, logEps)
    if (improved.logNfa <= logEps) continue
    const r = improved.rec
    // The gradient was computed with a 2×2 mask: add the (0.5, 0.5) offset; then undo the subsampling.
    let x1 = r.x1 + 0.5
    let y1 = r.y1 + 0.5
    let x2 = r.x2 + 0.5
    let y2 = r.y2 + 0.5
    let width = r.width
    if (scale !== 1.0) {
      x1 /= scale
      y1 /= scale
      x2 /= scale
      y2 /= scale
      width /= scale
    }
    out.push({ x1, y1, x2, y2, width, p: r.p, logNfa: improved.logNfa })
  }
  return out
}
