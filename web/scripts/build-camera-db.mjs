// Builds src/engine/raw/camera-db.json from darktable's camera database (rawspeed data/cameras.xml).
//
// Usage: node scripts/build-camera-db.mjs path/to/cameras.xml
// Source: https://github.com/darktable-org/rawspeed/blob/develop/data/cameras.xml (CC-BY-SA 3.0)
//
// Output: { "<Make>|<Model>": [[mode, black, white, isoMin, isoMax], ...] } (iso 0 = any) using rawspeed's canonical <ID> names, which
// match LibRaw's normalized make/model. Only cameras rawspeed supports are included.
import { readFileSync, writeFileSync } from 'node:fs'

const xml = readFileSync(process.argv[2], 'utf8')
const db = {}
let count = 0
for (const m of xml.matchAll(/<Camera\s([^>]*)>([\s\S]*?)<\/Camera>/g)) {
  const attrs = m[1]
  const body = m[2]
  if (/supported="no"/.test(attrs)) continue
  const id = /<ID make="([^"]*)" model="([^"]*)">/.exec(body)
  if (!id) continue
  const mode = /mode="([^"]*)"/.exec(attrs)?.[1] ?? ''
  const key = `${id[1]}|${id[2]}`
  // A camera can list one sensor entry, or several by ISO (iso_list="…" or iso_min/iso_max).
  for (const sm of body.matchAll(/<Sensor ([^>]*)\/>/g)) {
    const a = sm[1]
    const black = Number(/black="(-?\d+)"/.exec(a)?.[1])
    const white = Number(/white="(\d+)"/.exec(a)?.[1])
    if (!Number.isFinite(black) || !Number.isFinite(white)) continue
    const isoList = /iso_list="([^"]*)"/.exec(a)?.[1]
    const ranges = isoList
      ? isoList.trim().split(/\s+/).map((v) => [Number(v), Number(v)])
      : [[Number(/iso_min="(\d+)"/.exec(a)?.[1] ?? 0), Number(/iso_max="(\d+)"/.exec(a)?.[1] ?? 0)]]
    db[key] ??= []
    for (const [lo, hi] of ranges) {
      const entry = [mode, black, white, lo, hi]
      if (!db[key].some((e) => e.join() === entry.join())) {
        db[key].push(entry)
        count++
      }
    }
  }
}
const header = {
  _source: 'darktable rawspeed data/cameras.xml (CC-BY-SA 3.0, https://github.com/darktable-org/rawspeed)',
  _format: 'make|model -> [[mode, black, white, isoMin, isoMax], ...] (iso 0 = any)',
}
writeFileSync(new URL('../src/engine/raw/camera-db.json', import.meta.url), JSON.stringify({ ...header, ...db }))
console.log(`${Object.keys(db).length} cameras, ${count} sensor modes`)
