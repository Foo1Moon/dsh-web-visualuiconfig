/**
 * Browser-side config persistence over the shared model.
 *
 * The model (types, defaults, sanitize, asset refs) lives in
 * src/shared/config.ts — environment-agnostic, imported by both the host and
 * the browser halves. This module adds the browser-only persistence surface:
 * the localStorage cache under a single versioned key. localStorage is always
 * written as a cache; the authoritative store is the host file when
 * `storageMode === 'host'` (see src/client/host.ts and the store in
 * src/client/index.ts), or localStorage alone when 'browser'.
 */
import type { PersonalizationConfig } from '../shared/config.ts'
import { DEFAULT_CONFIG, sanitizeConfig } from '../shared/config.ts'

export * from '../shared/config.ts'

/** localStorage key holding the whole configuration document (cache). */
export const STORAGE_KEY = 'dsh.personalization.v1'

/** Read and sanitize the persisted configuration from localStorage. */
export function loadConfig(): PersonalizationConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? structuredClone(DEFAULT_CONFIG) as PersonalizationConfig : sanitizeConfig(JSON.parse(raw))
  } catch {
    return structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  }
}

/** Persist a configuration document to the localStorage cache. */
export function saveConfig(config: PersonalizationConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Quota exceeded or storage disabled: the in-memory config still applies
    // for this page lifetime; persistence silently degrades.
  }
}

/** Whether localStorage holds a personalization document at all. */
export function hasLocalConfig(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}
