// The Nelder-Mead simplex minimiser that darktable's "rotate and perspective" module (ashift) uses to fit its
// perspective model and its automatic crop.
//
// Translated to TypeScript for LightBench (2026) from darktable's src/iop/ashift_nmsimplex.c:
//
//   This file is part of darktable,
//   Copyright (C) 2016-2020 darktable developers.
//   darktable is free software: you can redistribute it and/or modify it under the terms of the GNU General
//   Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
//   option) any later version.
//
// which itself is Michael F. Hutt's nmsimplex.c (http://www.mikehutt.com/neldermead.html, downloaded by darktable
// on February 6, 2016), under this notice:
//
//   Copyright (c) 1997-2011 <Michael F. Hutt>
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without
//   limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
//   Software, and to permit persons to whom the Software is furnished to do so, subject to the following
//   conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or substantial
//   portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
//   TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//   THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// Changes in the translation: arrays instead of malloc'd rows; the objective function is a closure instead of a
// function pointer plus a `void *params`. The algorithm, its coefficients and its quirks are kept (including
// darktable's: the initial constraint call applies to the last vertex only, as `constrain(v[j], n)` does there
// after the loops).

/** darktable's NMS_ALPHA, NMS_BETA, NMS_GAMMA (ashift.c). */
const NMS_ALPHA = 1.0
const NMS_BETA = 0.5
const NMS_GAMMA = 2.0

/**
 * Minimises `objfunc` starting from `start` (updated in place with the best vertex). Returns the number of
 * iterations used; `maxiter + 1` means it did not converge (darktable treats `>= maxiter` as failure).
 */
export function simplex(
  objfunc: (p: number[]) => number,
  start: number[],
  n: number,
  EPSILON: number,
  scale: number,
  maxiter: number,
  constrain: ((p: number[], n: number) => void) | null = null,
): number {
  const v: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n).fill(0))
  const f = new Array<number>(n + 1).fill(0)
  const vr = new Array<number>(n).fill(0)
  const ve = new Array<number>(n).fill(0)
  const vc = new Array<number>(n).fill(0)
  const vm = new Array<number>(n).fill(0)

  // create the initial simplex; assume one of the vertices is 0,0
  const pn = (scale * (Math.sqrt(n + 1) - 1 + n)) / (n * Math.sqrt(2))
  const qn = (scale * (Math.sqrt(n + 1) - 1)) / (n * Math.sqrt(2))
  for (let i = 0; i < n; i++) v[0][i] = start[i]
  let j = 0
  for (let i = 1; i <= n; i++) {
    for (j = 0; j < n; j++) v[i][j] = i - 1 === j ? pn + start[j] : qn + start[j]
  }
  if (constrain) constrain(v[j], n)
  for (j = 0; j <= n; j++) f[j] = objfunc(v[j])

  let itr: number
  for (itr = 1; itr <= maxiter; itr++) {
    // index of the largest value
    let vg = 0
    for (j = 0; j <= n; j++) if (f[j] > f[vg]) vg = j
    // index of the smallest value
    let vs = 0
    for (j = 0; j <= n; j++) if (f[j] < f[vs]) vs = j
    // index of the second largest value
    let vh = vs
    for (j = 0; j <= n; j++) if (f[j] > f[vh] && f[j] < f[vg]) vh = j

    // centroid
    for (j = 0; j <= n - 1; j++) {
      let cent = 0
      for (let m = 0; m <= n; m++) if (m !== vg) cent += v[m][j]
      vm[j] = cent / n
    }

    // reflect vg to new vertex vr
    for (j = 0; j <= n - 1; j++) vr[j] = vm[j] + NMS_ALPHA * (vm[j] - v[vg][j])
    if (constrain) constrain(vr, n)
    const fr = objfunc(vr)

    if (fr < f[vh] && fr >= f[vs]) {
      for (j = 0; j <= n - 1; j++) v[vg][j] = vr[j]
      f[vg] = fr
    }

    // investigate a step further in this direction
    if (fr < f[vs]) {
      for (j = 0; j <= n - 1; j++) ve[j] = vm[j] + NMS_GAMMA * (vr[j] - vm[j])
      if (constrain) constrain(ve, n)
      const fe = objfunc(ve)
      if (fe < fr) {
        for (j = 0; j <= n - 1; j++) v[vg][j] = ve[j]
        f[vg] = fe
      } else {
        for (j = 0; j <= n - 1; j++) v[vg][j] = vr[j]
        f[vg] = fr
      }
    }

    // check to see if a contraction is necessary
    if (fr >= f[vh]) {
      let fc: number
      if (fr < f[vg] && fr >= f[vh]) {
        // outside contraction
        for (j = 0; j <= n - 1; j++) vc[j] = vm[j] + NMS_BETA * (vr[j] - vm[j])
        if (constrain) constrain(vc, n)
        fc = objfunc(vc)
      } else {
        // inside contraction
        for (j = 0; j <= n - 1; j++) vc[j] = vm[j] - NMS_BETA * (vm[j] - v[vg][j])
        if (constrain) constrain(vc, n)
        fc = objfunc(vc)
      }
      if (fc < f[vg]) {
        for (j = 0; j <= n - 1; j++) v[vg][j] = vc[j]
        f[vg] = fc
      } else {
        // the contraction failed: halve the distance from vs to all the vertices
        for (let row = 0; row <= n; row++) {
          if (row !== vs) for (j = 0; j <= n - 1; j++) v[row][j] = v[vs][j] + (v[row][j] - v[vs][j]) / 2.0
        }
        if (constrain) constrain(v[vg], n)
        f[vg] = objfunc(v[vg])
        if (constrain) constrain(v[vh], n)
        f[vh] = objfunc(v[vh])
      }
    }

    // test for convergence
    let fsum = 0
    for (j = 0; j <= n; j++) fsum += f[j]
    const favg = fsum / (n + 1)
    let s = 0
    for (j = 0; j <= n; j++) s += (f[j] - favg) ** 2 / n
    s = Math.sqrt(s)
    if (s < EPSILON) break
  }

  let vs = 0
  for (j = 0; j <= n; j++) if (f[j] < f[vs]) vs = j
  for (j = 0; j < n; j++) start[j] = v[vs][j]
  return itr
}
