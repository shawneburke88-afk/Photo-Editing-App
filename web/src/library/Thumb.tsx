import { memo, useEffect, useState } from 'react'
import { thumbEvents, thumbUrl } from '../catalog/thumbs'

/** A cached thumbnail from the library's thumbnail store. */
export const Thumb = memo(function Thumb({ id, alt = '' }: { id: number; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const onChange = (e: Event) => (e as CustomEvent<number>).detail === id && setVersion((v) => v + 1)
    thumbEvents.addEventListener('thumbchange', onChange)
    return () => thumbEvents.removeEventListener('thumbchange', onChange)
  }, [id])
  useEffect(() => {
    let live = true
    void thumbUrl(id).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [id, version])
  return url ? <img src={url} alt={alt} draggable={false} /> : <span className="thumb-missing" aria-hidden />
})
