/**
 * Personalization plugin, browser half: applies the persisted configuration
 * to the document through the engine and registers the settings page into the
 * settings panel's `settings.section` slot.
 *
 * The config store is a tiny subscribe/getSnapshot source owned by this apply
 * body (the same shape as the official store handles, without importing the
 * runtime store engine): the engine effect and the settings page both read
 * through it, and every mutation persists to localStorage.
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
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './settings.ts'
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

/** A minimal subscribe/getSnapshot source over the config document. */
interface ConfigStore {
  getSnapshot: () => PersonalizationConfig
  subscribe: (listener: () => void) => () => void
  update: (recipe: (prev: PersonalizationConfig) => PersonalizationConfig) => void
  reset: () => void
}

/** Create the config store, seeded from localStorage. */
function createConfigStore(): ConfigStore {
  let config = loadConfig()
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => config,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (recipe) => {
      config = recipe(config)
      saveConfig(config)
      emit()
    },
    reset: () => {
      config = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
      saveConfig(config)
      emit()
    },
  }
}

/**
 * Browser plugin body: register dictionaries, run the engine from the config
 * store, and seat the settings page in the settings panel.
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

  const injected = (): PersonalizationInjected => ({
    useConfig: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
    update: (recipe) => store.update(recipe),
    reset: () => store.reset(),
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
