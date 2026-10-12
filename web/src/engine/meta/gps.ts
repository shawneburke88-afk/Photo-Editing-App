// GPS position from EXIF (JPEG) or LibRaw (RAW), as signed decimal degrees.
//
// EXIF stores latitude and longitude as degrees, minutes and seconds with N/S and E/W references, and altitude
// with a reference byte (1 = below sea level) (EXIF 2.32, GPS Info IFD tags 1–6). The checks follow LightCraft's
// crates/meta/src/exif.rs `read_gps`: a position needs both coordinates, inside ±90° / ±180°.

export interface GpsPosition {
  /** Degrees, north positive. */
  lat: number
  /** Degrees, east positive. */
  lon: number
  /** Metres above sea level (negative below), when recorded. */
  alt?: number
}

/** Degrees from [degrees, minutes, seconds]. */
export function dmsToDegrees(dms: ArrayLike<number>): number {
  return (dms[0] ?? 0) + (dms[1] ?? 0) / 60 + (dms[2] ?? 0) / 3600
}

/**
 * A position from EXIF-style values: the D/M/S triples, the reference letters ('N'/'S', 'E'/'W') and the
 * altitude with its reference (0 above, 1 below sea level). Null when it isn't a usable position.
 */
export function gpsFromDms(lat: ArrayLike<number> | null, latRef: string, lon: ArrayLike<number> | null, lonRef: string, alt?: number | null, altRef?: number): GpsPosition | null {
  if (!lat || !lon || lat.length < 1 || lon.length < 1) return null
  let la = dmsToDegrees(lat)
  let lo = dmsToDegrees(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (latRef.trim().toUpperCase().startsWith('S')) la = -la
  if (lonRef.trim().toUpperCase().startsWith('W')) lo = -lo
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  const out: GpsPosition = { lat: la, lon: lo }
  if (alt !== undefined && alt !== null && Number.isFinite(alt)) out.alt = altRef === 1 ? -alt : alt
  return out
}

/** LibRaw's `imgother.parsed_gps` (src/metadata/exif_gps.cpp, parse_gps_libraw). */
export interface LibRawGps {
  latitude: ArrayLike<number>
  longitude: ArrayLike<number>
  altitude: number
  altref: number
  latref: number
  longref: number
  gpsparsed: number
}

/**
 * A position from LibRaw. LibRaw sets `gpsparsed` as soon as the GPS IFD has any entry (a Nikon writes one with
 * only its version when no GPS unit is attached), and keeps the reference letters as character codes, 0 when absent;
 * so a position needs both reference letters. Altitude counts only when its tag was there (LibRaw leaves 0 otherwise,
 * which can't be told from sea level: it is kept only with a reference byte or a non-zero value).
 */
export function gpsFromLibRaw(g: LibRawGps | undefined | null): GpsPosition | null {
  if (!g || !g.gpsparsed) return null
  const latRef = String.fromCharCode(g.latref || 0)
  const lonRef = String.fromCharCode(g.longref || 0)
  if (!'NS'.includes(latRef.toUpperCase()) || !'EW'.includes(lonRef.toUpperCase()) || !g.latref || !g.longref) return null
  return gpsFromDms(g.latitude, latRef, g.longitude, lonRef, g.altitude || null, g.altref)
}

/** "45.42153° N, 75.69719° W · 70 m", as the Info panel shows it. */
export function formatGps(p: { lat: number; lon: number; alt?: number | null }): string {
  const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(5)}° ${v < 0 ? neg : pos}`
  const where = `${deg(p.lat, 'N', 'S')}, ${deg(p.lon, 'E', 'W')}`
  return p.alt !== undefined && p.alt !== null ? `${where} · ${Math.round(p.alt)} m` : where
}
