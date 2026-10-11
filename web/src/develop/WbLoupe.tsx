import { useEffect, useRef } from 'react'

interface Props {
  /** Loupe position in the stage, CSS px (the cursor). */
  x: number
  y: number
  /** A small 100 % crop centred on the cursor (odd size). */
  image: ImageData
  /** Magnification of each image pixel. */
  zoom: number
}

/**
 * Magnifier for the white balance picker: shows the pixels under the cursor enlarged, the target pixel
 * outlined, and its R/G/B values (as Lightroom's white balance selector does).
 */
export function WbLoupe({ x, y, image, zoom }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const n = image.width
  const c = (n - 1) / 2

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const src = new OffscreenCanvas(n, n)
    src.getContext('2d')!.putImageData(image, 0, 0)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(src, 0, 0, n * zoom, n * zoom)
    // pixel grid
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.lineWidth = 1
    for (let i = 1; i < n; i++) {
      ctx.beginPath()
      ctx.moveTo(i * zoom + 0.5, 0)
      ctx.lineTo(i * zoom + 0.5, n * zoom)
      ctx.moveTo(0, i * zoom + 0.5)
      ctx.lineTo(n * zoom, i * zoom + 0.5)
      ctx.stroke()
    }
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(c * zoom - 1, c * zoom - 1, zoom + 2, zoom + 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.strokeRect(c * zoom - 2.5, c * zoom - 2.5, zoom + 5, zoom + 5)
  }, [image, n, c, zoom])

  const i = (c * n + c) * 4
  const pct = (v: number) => `${((v / 255) * 100).toFixed(1)}`
  const size = n * zoom
  // Keep the loupe beside the cursor, flipping sides near the right/bottom edges.
  const left = x + 24 + size > window.innerWidth - 300 ? x - 24 - size : x + 24
  return (
    <div className="wb-loupe" style={{ left, top: Math.max(4, y - size / 2) }} aria-hidden="true">
      <canvas ref={ref} width={size} height={size} />
      <div className="wb-loupe-rgb">
        R {pct(image.data[i])} % · G {pct(image.data[i + 1])} % · B {pct(image.data[i + 2])} %
      </div>
    </div>
  )
}
