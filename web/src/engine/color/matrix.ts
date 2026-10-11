// Small 3×3 matrix helpers and the colour-space matrices the pipeline uses (all D65).

export type Mat3 = [number, number, number, number, number, number, number, number, number] // row-major
export type Vec3 = [number, number, number]

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible')
  const s = 1 / det
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ]
}

/** Linear sRGB → XYZ (D65). */
export const SRGB_TO_XYZ: Mat3 = [
  0.4124564, 0.3575761, 0.1804375,
  0.2126729, 0.7151522, 0.072175,
  0.0193339, 0.119192, 0.9503041,
]

/** Linear Rec.2020 → XYZ (D65). darktable's default working space is linear Rec.2020. */
export const REC2020_TO_XYZ: Mat3 = [
  0.636958, 0.1446169, 0.1688810,
  0.2627002, 0.6779981, 0.0593017,
  0.0, 0.0280727, 1.0609851,
]

export const XYZ_TO_REC2020 = invert(REC2020_TO_XYZ)
export const XYZ_TO_SRGB = invert(SRGB_TO_XYZ)
export const REC2020_TO_SRGB = mul(XYZ_TO_SRGB, REC2020_TO_XYZ)
export const SRGB_TO_REC2020 = mul(XYZ_TO_REC2020, SRGB_TO_XYZ)
