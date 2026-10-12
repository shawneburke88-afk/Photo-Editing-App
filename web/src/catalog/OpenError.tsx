import { useEffect } from 'react'
import { updates } from '../pwa/register'
import { NEWER_CATALOG_MESSAGE } from './errors'

/** Why the library couldn't be opened, with a Reload button (into the new version when one is waiting). */
export function CatalogOpenError({ message }: { message: string }) {
  const newer = message === NEWER_CATALOG_MESSAGE
  useEffect(() => {
    if (newer) updates.check()
  }, [newer])
  return (
    <div className="center error catalog-error" role="alert">
      <p>{message}</p>
      <button className="button primary" onClick={() => updates.apply()}>Reload</button>
    </div>
  )
}
