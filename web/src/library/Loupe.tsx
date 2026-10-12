import { useEffect, useRef, useState } from 'react'
import type { PhotoDetail } from '../catalog/types'
import { currentDisplaySpace } from '../engine/gpu/display-space'
import { checkPhoto } from '../sidecar/watch'
import { loadFullPreview, loadThumbPreview, type Preview } from './preview'

/**
 * Large single-photo view. For RAW files it shows the camera's embedded full-size preview (fast, like
 * darktable's default for unedited images) and says so; the RAW itself is rendered in Develop.
 */
export function Loupe({ photo }: { photo: PhotoDetail }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bitmap, setBitmap] = useState<Preview | null>(null)
  const [note, setNote] = useState('')

  // Has another app changed this photo's sidecar? (One file date; the notice asks what to do.)
  useEffect(() => void checkPhoto(photo.id), [photo.id])

  useEffect(() => {
    let live = true
    let loaded: ImageBitmap | null = null
    setNote('')
    ;(async () => {
      // Show the thumbnail immediately, then swap in the full-size preview.
      const thumb = await loadThumbPreview(photo.id)
      if (thumb && live) {
        loaded = thumb.bmp
        setBitmap(thumb)
      }
      const full = await loadFullPreview(photo)
      if (!live) {
        full.bmp.close()
        return
      }
      loaded?.close()
      loaded = full.bmp
      setBitmap(full)
    })().catch((e: Error) => live && setNote(e.message))
    return () => {
      live = false
      loaded?.close()
    }
    // Reload only when the file changes, not when its rating or label does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const ctx = canvas.getContext('2d', { colorSpace: currentDisplaySpace() })!
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
