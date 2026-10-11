import { useEffect, useRef, useState } from 'react'
import { loadThumb } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import { RawDecoder } from '../engine/raw/decoder'
import { openPhotoFile } from '../platform/roots'

let decoder: RawDecoder | null = null
const FLIP_TO_ROTATION: Record<number, number> = { 0: 0, 3: 180, 5: 270, 6: 90 }

/**
 * Large single-photo view. For RAW files it shows the camera's embedded full-size preview (fast, like
 * darktable's default for unedited images) and says so; the RAW itself is rendered in Develop.
 */
export function Loupe({ photo }: { photo: PhotoDetail }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** `camera`: the RAW's embedded preview (not a rendering of the RAW itself). */
  const [bitmap, setBitmap] = useState<{ bmp: ImageBitmap; rotate: number; camera: boolean } | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    let loaded: ImageBitmap | null = null
    setNote('')
    ;(async () => {
      // Show the thumbnail immediately, then swap in the full-size preview.
      const thumb = await loadThumb(photo.id)
      if (thumb && live) {
        loaded = await createImageBitmap(thumb)
        if (live) setBitmap({ bmp: loaded, rotate: 0, camera: false })
      }
      const file = await openPhotoFile(photo.rootId, photo.folderPath, photo.fileName)
      if (!file) {
        if (live) setNote('Showing a small preview. Reconnect this photo’s folder to see it full size.')
        return
      }
      let full: ImageBitmap
      let rotate = 0
      if (/^jpe?g$/i.test(photo.fileType)) {
        full = await createImageBitmap(file)
      } else {
        decoder ??= new RawDecoder()
        const r = await decoder.decode(file, false)
        if (!r.preview || r.preview.format !== 'jpeg') {
          if (live) setNote('This file has no full-size preview; full RAW rendering comes with the Develop module.')
          return
        }
        full = await createImageBitmap(new Blob([r.preview.bytes], { type: 'image/jpeg' }))
        rotate = FLIP_TO_ROTATION[photo.orientation] ?? 0
        if ((rotate === 90 || rotate === 270) && full.height > full.width) rotate = 0
      }
      if (!live) {
        full.close()
        return
      }
      loaded?.close()
      loaded = full
      setBitmap({ bmp: full, rotate, camera: !/^jpe?g$/i.test(photo.fileType) })
    })().catch((e: Error) => live && setNote(`Could not open this photo: ${e.message}`))
    return () => {
      live = false
      loaded?.close()
    }
  }, [photo.id, photo.rootId, photo.folderPath, photo.fileName, photo.fileType, photo.orientation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(canvas.clientWidth * dpr)
      const ch = Math.round(canvas.clientHeight * dpr)
      canvas.width = cw
      canvas.height = ch
      const { bmp, rotate } = bitmap
      const sideways = rotate === 90 || rotate === 270
      const iw = sideways ? bmp.height : bmp.width
      const ih = sideways ? bmp.width : bmp.height
      const scale = Math.min(cw / iw, ch / ih)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, cw, ch)
      ctx.translate(cw / 2, ch / 2)
      ctx.rotate((rotate * Math.PI) / 180)
      const dw = (sideways ? ih : iw) * scale
      const dh = (sideways ? iw : ih) * scale
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [bitmap])

  return (
    <div className="loupe">
      <canvas ref={canvasRef} className="loupe-canvas" aria-label={photo.fileName} />
      {bitmap?.camera && (
        <span className="preview-badge" title="The JPEG preview your camera stored in the RAW file. Press D to render the RAW itself in Develop.">
          Camera preview
        </span>
      )}
      {note && <p className="loupe-note">{note}</p>}
    </div>
  )
}
