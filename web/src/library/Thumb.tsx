import { memo, useEffect, useState } from 'react'
import { thumbUrl } from '../catalog/thumbs'

/** A cached thumbnail from the library's thumbnail store. */
export const Thumb = memo(function Thumb({ id, alt = '' }: { id: number; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void thumbUrl(id).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [id])
  return url ? <img src={url} alt={alt} draggable={false} /> : <span className="thumb-missing" aria-hidden />
})
