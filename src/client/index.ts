/**
 * Personalization plugin, browser half: applies the persisted configuration
 * to the document through the engine and registers the settings page into the
 * settings panel's `settings.section` slot.
 *
 * The config store is a tiny subscribe/getSnapshot source owned by this apply
 * body (the same shape as the official store handles, without importing the
 * runtime store engine): the engine effect and the settings page both read
 * through it, and every mutation persists to localStorage (always, as cache)
 * and, in host mode, to the machine file through the /personalization routes.
 *
 * Host-mode orchestration: on mount the store fetches the host config (the
 * host file is authoritative when present), seeds the host from the local
 * cache when the host is empty (the upgrade migration), and follows the
 * host's SSE revision channel so other tabs / agents see changes immediately.
 * When the host half is unavailable (e.g. dsh web not restarted after this
 * update), the store degrades to browser-only persistence.
 */
import { useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings slot declarations (ctx.settingsScope and the
// `settings.section` SlotMap entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonalizationConfig } from './settings.ts'
import { DEFAULT_CONFIG, hasLocalConfig, loadConfig, saveConfig } from './settings.ts'
import { sanitizeConfig } from '../shared/config.ts'
import { fetchHostConfig, putHostConfig, uploadAsset } from './host.ts'
import { applyPersonalization } from './engine.ts'
import { PersonalizationSection, type PersonalizationInjected } from './PersonalizationSection.tsx'
import { en, zh, type PersonalizationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The personalization settings page's copy. */
    'settings.personalization': PersonalizationKey
  }
}

/** Locale namespace owning the settings page copy. */
const NS = 'settings.personalization'

/** Required services. */
export const inject = ['slots', 'locale']

/** Debounce before a host PUT after a change (collapses slider drags). */
const PUT_DEBOUNCE_MS = 300

/** A minimal subscribe/getSnapshot source over the config document. */
interface ConfigStore {
  getSnapshot: () => PersonalizationConfig
  subscribe: (listener: () => void) => () => void
  update: (recipe: (prev: PersonalizationConfig) => PersonalizationConfig) => void
  reset: () => void
  /** Whether the host half answered at least once (same-origin routes exist). */
  getHostAvailable: () => boolean
  subscribeHost: (listener: () => void) => () => void
  /** Re-sync from the host (initial load, SSE revision, manual refresh). */
  syncFromHost: () => Promise<void>
  /** React to a host revision announcement, fetching only when newer. */
  notifyRevision: (revision: number) => void
  /** Upload a compressed image to the host; returns the asset id or null. */
  uploadImage: (dataUrl: string) => Promise<string | null>
}

/** Create the config store, seeded from localStorage. */
function createConfigStore(): ConfigStore {
  let config = loadConfig()
  let hostAvailable = true
  let lastRevision = 0
  let putTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  const hostListeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const emitHost = (): void => {
    for (const listener of hostListeners) listener()
  }
  const setHostAvailable = (value: boolean): void => {
    if (value === hostAvailable) return
    hostAvailable = value
    emitHost()
  }
  /** Effective host mode: configured AND the host answered. */
  const effectiveHost = (): boolean => hostAvailable && config.storageMode === 'host'

  /** Persist locally, then schedule a debounced host PUT in host mode. */
  const persist = (next: PersonalizationConfig): void => {
    config = next
    saveConfig(next)
    if (effectiveHost()) schedulePut(next)
    emit()
  }

  const schedulePut = (cfg: PersonalizationConfig): void => {
    if (putTimer !== null) clearTimeout(putTimer)
    putTimer = setTimeout(() => {
      putTimer = null
      void putHostConfig(cfg).then(revision => {
        if (revision === null) setHostAvailable(false)
        else if (revision > lastRevision) lastRevision = revision
      })
    }, PUT_DEBOUNCE_MS)
  }

  /** Adopt a host document as authoritative and re-emit. */
  const adopt = (revision: number, raw: unknown): void => {
    lastRevision = revision
    config = sanitizeConfig(raw)
    saveConfig(config)
    emit()
  }

  const syncFromHost = async (): Promise<void> => {
    const result = await fetchHostConfig()
    if (result.kind === 'unavailable') {
      setHostAvailable(false)
      return
    }
    setHostAvailable(true)
    // Browser mode opted out of the machine store: the host file is not
    // authoritative, so neither adopt its content nor seed it from the cache.
    if (config.storageMode !== 'host') return
    if (result.kind === 'ok') {
      if (result.revision > lastRevision) adopt(result.revision, result.config)
      return
    }
    // Host empty: seed it from the local cache (the upgrade migration — an
    // older browser-mode document becomes the machine file's first content).
    if (hasLocalConfig()) {
      const revision = await putHostConfig(config)
      if (revision !== null) lastRevision = revision
    }
  }

  return {
    getSnapshot: () => config,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getHostAvailable: () => hostAvailable,
    subscribeHost: (listener) => {
      hostListeners.add(listener)
      return () => {
        hostListeners.delete(listener)
      }
    },
    update: (recipe) => {
      persist(recipe(config))
    },
    reset: () => {
      persist(structuredClone(DEFAULT_CONFIG) as PersonalizationConfig)
    },
    syncFromHost,
    notifyRevision: (revision) => {
      if (revision > lastRevision) void syncFromHost()
    },
    uploadImage: (dataUrl) => uploadAsset(dataUrl),
  }
}

/**
 * Browser plugin body: register dictionaries, run the engine from the config
 * store, keep it in sync with the host, and seat the settings page in the
 * settings panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'personalization: dictionaries')

  const store = createConfigStore()
  const t = ctx.locale.bind(NS)

  // The engine replays the whole config on every change (idempotent writes +
  // full retraction on dispose, the skin protocol).
  ctx.effect(() => {
    let dispose = applyPersonalization(store.getSnapshot())
    const off = store.subscribe(() => {
      dispose()
      dispose = applyPersonalization(store.getSnapshot())
    })
    return () => {
      off()
      dispose()
    }
  }, 'personalization: engine')

  // Host sync: initial fetch (with empty-host seeding) and the SSE revision
  // channel that keeps every open tab — and agent-side changes — in lockstep.
  ctx.effect(() => {
    void store.syncFromHost()
    const events = new EventSource('/personalization/events')
    events.onmessage = (event: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(event.data) as { revision?: unknown }
        if (typeof frame?.revision === 'number') store.notifyRevision(frame.revision)
      } catch {
        // Ignore malformed frames.
      }
    }
    return () => events.close()
  }, 'personalization: host sync')

  const injected = (): PersonalizationInjected => ({
    useConfig: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
    update: (recipe) => store.update(recipe),
    reset: () => store.reset(),
    useHostAvailable: () => useSyncExternalStore(store.subscribeHost, store.getHostAvailable),
    uploadImage: (dataUrl) => store.uploadImage(dataUrl),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personalization',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, PersonalizationSection))
}
