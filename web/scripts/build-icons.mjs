#!/usr/bin/env node
// Builds the installed-app icons (web/public/icons/*.png) from the brand mark in web/public/favicon.svg,
// so the app icon is the same drawing as the favicon and the mark in the top bar.
//
// favicon.svg is drawn from three simple shapes (a rounded square, a ring and a dot), so this script reads
// their attributes from the file and rasterises them itself (8×8 samples per pixel) instead of needing an
// SVG renderer. It handles only <rect> and <circle> with fill / stroke, and stops if the SVG has anything else.
//
// Usage: node web/scripts/build-icons.mjs   (the PNGs are committed; rerun when favicon.svg changes)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '..', 'public')
const svg = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8')

const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number)
if (viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] !== viewBox[3]) throw new Error('favicon.svg: expected a square viewBox from 0 0')
const VIEW = viewBox[2]

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const shapes = []
for (const m of svg.matchAll(/<(\w+)\b([^>]*)\/?>/g)) {
  const [, name, rest] = m
  if (name === 'svg') continue
  const a = attrs(rest)
  if (name === 'rect') shapes.push({ kind: 'rect', w: +a.width, h: +a.height, rx: +(a.rx ?? 0), fill: a.fill })
  else if (name === 'circle') shapes.push({ kind: 'circle', cx: +a.cx, cy: +a.cy, r: +a.r, fill: a.fill, stroke: a.stroke, sw: +(a['stroke-width'] ?? 1) })
  else throw new Error(`favicon.svg: <${name}> is not supported by this script`)
}

const colours = new Map()
const rgb = (hex) => {
  if (!colours.has(hex)) colours.set(hex, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255))
  return colours.get(hex)
}

/** Inside test in viewBox units. `square`: the background rect without rounded corners (maskable icons). */
function paints(shape, x, y, square) {
  if (shape.kind === 'rect') {
    if (x < 0 || y < 0 || x > shape.w || y > shape.h) return null
    const r = square ? 0 : shape.rx
    const dx = Math.max(r - x, x - (shape.w - r), 0)
    const dy = Math.max(r - y, y - (shape.h - r), 0)
    return dx * dx + dy * dy <= r * r ? shape.fill : null
  }
  const d = Math.hypot(x - shape.cx, y - shape.cy)
  if (shape.stroke && shape.stroke !== 'none' && Math.abs(d - shape.r) <= shape.sw / 2) return shape.stroke
  if (shape.fill && shape.fill !== 'none' && d <= shape.r) return shape.fill
  return null
}

/** RGBA pixels; each pixel averages 8×8 samples, compositing the shapes in order. */
function render(size, square) {
  const N = 8
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = ((px + (sx + 0.5) / N) / size) * VIEW
          const y = ((py + (sy + 0.5) / N) / size) * VIEW
          let colour = null
          for (const s of shapes) colour = paints(s, x, y, square) ?? colour
          if (!colour) continue
          const [cr, cg, cb] = rgb(colour)
          r += cr; g += cg; b += cb; a++
        }
      }
      const i = (py * size + px) * 4
      // Unpremultiply: colour sums are over painted samples only.
      out[i] = a ? Math.round((r / a) * 255) : 0
      out[i + 1] = a ? Math.round((g / a) * 255) : 0
      out[i + 2] = a ? Math.round((b / a) * 255) : 0
      out[i + 3] = Math.round((a / (N * N)) * 255)
    }
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// "any" icons keep the favicon's rounded square. Maskable and Apple icons fill the square (the OS applies
// its own mask); the mark already sits inside the maskable safe zone (ring radius 0.32 of the size, limit 0.4).
const ICONS = [
  { file: 'icon-192.png', size: 192, square: false },
  { file: 'icon-512.png', size: 512, square: false },
  { file: 'icon-maskable-512.png', size: 512, square: true },
  { file: 'apple-touch-icon-180.png', size: 180, square: true },
]

mkdirSync(join(PUBLIC, 'icons'), { recursive: true })
for (const { file, size, square } of ICONS) {
  writeFileSync(join(PUBLIC, 'icons', file), png(size, render(size, square)))
  console.log(`icons/${file} (${size}×${size})`)
}
