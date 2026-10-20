// Connects the recorder to the engine and the page: when diagnostics is on, the computer's description once per
// session and every engine event go into the log; when it is off, the engine has no trace and nothing is recorded.

import { useSyncExternalStore } from 'react'
import { liveEngines, setEngineTrace } from '../engine/gpu/develop-engine'
import { pcInfo } from './pcinfo'
import { diagnostics } from './recorder'

let described = false

function apply() {
  if (!diagnostics.enabled) {
    setEngineTrace(null)
    return
  }
  setEngineTrace((e) => diagnostics.log('engine', { ...e }))
  if (!described) {
    described = true
    void pcInfo(__APP_VERSION__).then((info) => diagnostics.log('session', info, 4000))
    // Engines made before diagnostics was turned on.
    for (const e of liveEngines) diagnostics.log('engine', { op: 'engine-present', info: { ...e.adapter }, mem: e.memoryStats() })
  }
}

/** Called once at start-up. */
export function startDiagnostics() {
  apply()
  diagnostics.subscribe(apply)
  window.addEventListener('error', (e) => diagnostics.log('page-error', { message: String(e.message).slice(0, 300) }))
  window.addEventListener('unhandledrejection', (e) => diagnostics.log('page-error', { rejection: String((e.reason as Error)?.message ?? e.reason).slice(0, 300) }))
}

export function useDiagnosticsOn(): boolean {
  return useSyncExternalStore(
    (fn) => diagnostics.subscribe(fn),
    () => diagnostics.enabled,
  )
}

/** `?memdebug` in the address shows the memory readout without turning diagnostics on. */
export const memDebugFlag = typeof location !== 'undefined' && new URLSearchParams(location.search).has('memdebug')

/** The GPU memory of every live engine, summed (estimates; see retire.ts). */
export function engineMemory(): { textureBytes: number; bufferBytes: number; retired: number; retiredBytes: number; leases: number; engines: number } {
  const t = { textureBytes: 0, bufferBytes: 0, retired: 0, retiredBytes: 0, leases: 0, engines: 0 }
  for (const e of liveEngines) {
    const m = e.memoryStats()
    t.textureBytes += m.textureBytes
    t.bufferBytes += m.bufferBytes
    t.retired += m.retired
    t.retiredBytes += m.retiredBytes
    t.leases += m.leases
    t.engines++
  }
  return t
}
