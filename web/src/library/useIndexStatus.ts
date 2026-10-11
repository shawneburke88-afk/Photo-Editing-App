import { useSyncExternalStore } from 'react'
import { indexer, type IndexStatus } from './indexer'

const subscribe = (fn: () => void) => indexer.subscribe(fn)
const snapshot = () => indexer.status

/** Follows the background folder indexer (Open folder). */
export const useIndexStatus = (): IndexStatus => useSyncExternalStore(subscribe, snapshot)
