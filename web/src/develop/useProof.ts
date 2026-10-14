// Develop's soft proofing state (docs/PHASE3.md Part 20): the settings (remembered in this browser, not part of the
// edit), the loaded profiles, and the proof table for the canvas, built in a worker when proofing is on and its
// profile or options change.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStoredJson } from '../lib/useStoredJson'
import type { ProofDraw } from '../engine/develop/indicators'
import type { ProofLut } from '../engine/proof/lut'
import { proofLut } from '../engine/proof/client'
import { cleanProof, DEFAULT_PROOF, lutOptions, proofKey, PROOF_STORAGE_KEY, type ProofSettings } from '../engine/proof/settings'
import { addUserProfile, listUserProfiles, proofSource, removeUserProfile, subscribeProfiles, type ProofSource, type UserProfile } from '../engine/proof/store'

export type ProofStatus = { kind: 'off' } | { kind: 'building' } | { kind: 'ready'; ms: number; outOfGamut: number } | { kind: 'error'; message: string }

export interface ProofState {
  settings: ProofSettings
  set: (s: ProofSettings) => void
  /** Profiles loaded in this browser. */
  profiles: UserProfile[]
  /** The destination now: its name and colour space (null while it is read). */
  source: Pick<ProofSource, 'id' | 'label' | 'space'> | null
  /** What Develop's canvas and histogram draw (undefined: not proofing, or the first table isn't ready yet). */
  draw: ProofDraw | undefined
  status: ProofStatus
  /** Loads an ICC file from disk and proofs to it. Rejects with a message for people. */
  load: (file: File) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useProof(): ProofState {
  const [stored, setStored] = useStoredJson<ProofSettings>(PROOF_STORAGE_KEY, DEFAULT_PROOF)
  const settings = useMemo(() => cleanProof(stored), [stored])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [source, setSource] = useState<ProofSource | null>(null)
  const [table, setTable] = useState<{ key: string; lut: ProofLut } | null>(null)
  const [status, setStatus] = useState<ProofStatus>({ kind: 'off' })

  useEffect(() => {
    let alive = true
    const refresh = () => void listUserProfiles().then((l) => alive && setProfiles(l))
    refresh()
    const stop = subscribeProfiles(refresh)
    return () => {
      alive = false
      stop()
    }
  }, [])

  // The destination's bytes: read when the setting names another profile, or the loaded ones change.
  useEffect(() => {
    let alive = true
    void proofSource(settings.profile).then((s) => {
      if (!alive) return
      // A loaded profile that was removed (here or in another tab): back to the default.
      if (!s && settings.profile !== DEFAULT_PROOF.profile) setStored({ ...settings, profile: DEFAULT_PROOF.profile })
      setSource(s)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.profile, profiles])

  // The table: built (or taken from the cache) when proofing is on and the destination or options change. The last
  // table stays on screen until the new one is ready.
  const options = lutOptions(settings)
  const key = source ? proofKey(source.hash, options) : null
  useEffect(() => {
    if (!settings.on || !source || !key) {
      setStatus({ kind: 'off' })
      return
    }
    let alive = true
    setStatus({ kind: 'building' })
    proofLut(source.hash, source.bytes, options).then(
      (lut) => {
        if (!alive) return
        setTable({ key, lut })
        setStatus({ kind: 'ready', ms: lut.ms, outOfGamut: lut.outOfGamut })
      },
      (e: unknown) => alive && setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.on, key])

  const draw = useMemo<ProofDraw | undefined>(
    () => (settings.on && table ? { key: table.key, lut: table.lut, destWarning: settings.destWarning, screenWarning: settings.screenWarning } : undefined),
    [settings.on, settings.destWarning, settings.screenWarning, table],
  )

  const set = useCallback((s: ProofSettings) => setStored(cleanProof(s)), [setStored])
  const load = useCallback(
    async (file: File) => {
      const p = await addUserProfile(file.name, new Uint8Array(await file.arrayBuffer()))
      set({ ...settings, on: true, profile: `user:${p.id}` })
    },
    [set, settings],
  )
  const remove = useCallback(
    async (id: string) => {
      await removeUserProfile(id)
      if (settings.profile === `user:${id}`) set({ ...settings, profile: DEFAULT_PROOF.profile })
    },
    [set, settings],
  )

  return { settings, set, profiles, source: source && { id: source.id, label: source.label, space: source.space }, draw, status, load, remove }
}
