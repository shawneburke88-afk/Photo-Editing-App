// Capture times. LightBench keeps a photo's capture time as the camera's clock written as if it were UTC (EXIF dates
// have no time zone), so a photo taken at 21:30 is 21:30 wherever and whenever the library is opened. The JPEG reader
// (engine/meta/exif.ts) does that. LibRaw gives a RAW's time as a real moment instead: it reads the camera's clock as
// this computer's local time (mktime). Without turning it back, a RAW and the JPEG of the same shot were this
// computer's UTC offset apart (3 hours in Atlantic time): sorted apart, under different dates in the Import window and,
// in the evening, imported into different dated folders.

/** LibRaw's capture time (seconds since 1970, local time of this computer) → the camera's clock as LightBench keeps it. */
export function cameraClockSeconds(libraw: number): number {
  if (!(libraw > 0)) return 0
  const d = new Date(libraw * 1000)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 1000)
}
