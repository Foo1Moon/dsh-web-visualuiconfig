/**
 * Panel detection: the surfaces the personalization can restyle independently.
 *
 * Each registered panel carries a DOM probe (`exists`) so the settings page
 * lists only what is actually present (the official columns always exist; a
 * third-party surface appears only when its plugin mounted it), and a scope
 * selector the engine prefixes with the personalization attribute scope so a
 * panel's token overrides reach only that panel's subtree.
 *
 * The three official columns carry `data-pane` attributes stamped by the
 * dsh-web-ui-all shim, with the class-name fallbacks (CSS Modules preserves
 * the `*Col` local names) when the shim is absent. The task-board and ssh
 * views mount inside the conversation column, so their own container
 * selectors stack a second override layer over whatever the conversation
 * column applies — each surface stays independently editable.
 */
import type { PersonalizationKey } from './locales.ts'
import type { PanelId } from './settings.ts'

/** One detectable panel: identity, copy key, and DOM presence probe. */
export interface PanelInfo {
  id: PanelId
  /** Locale key for the panel's display name. */
  labelKey: PersonalizationKey
  /** Whether the panel's surface is currently present in the DOM. */
  exists: () => boolean
}

/**
 * CSS suffix scoping a panel's token overrides to its own subtree. `''` means
 * the override lands on the personalization body scope itself.
 */
export const PANEL_SCOPE_SELECTOR: Record<PanelId, string> = Object.freeze({
  sidebar: '[data-pane="sidebar"],[class*="sidebarCol"]',
  conversation: '[data-pane="conversation"],[class*="centerCol"]',
  details: '[data-pane="details"],[class*="detailsCol"]',
  aionui: '[data-aionui-explorer-col],[data-aionui-preview-col]',
  taskboard: '[data-dsh-taskboard-view]',
  ssh: '[data-dsh-ssh-view]',
})

/** The panel registry, in display order. */
export const PANEL_REGISTRY: readonly PanelInfo[] = Object.freeze([
  Object.freeze({
    id: 'sidebar' as PanelId,
    labelKey: 'panel.sidebar' as PersonalizationKey,
    exists: () => true,
  }),
  Object.freeze({
    id: 'conversation' as PanelId,
    labelKey: 'panel.conversation' as PersonalizationKey,
    exists: () => true,
  }),
  Object.freeze({
    id: 'details' as PanelId,
    labelKey: 'panel.details' as PersonalizationKey,
    exists: () =>
      document.querySelector('[data-pane="details"],[class*="detailsCol"]') !== null,
  }),
  Object.freeze({
    id: 'aionui' as PanelId,
    labelKey: 'panel.aionui' as PersonalizationKey,
    exists: () =>
      document.querySelector('[data-aionui-explorer-col],[data-aionui-preview-col]') !== null,
  }),
  Object.freeze({
    id: 'taskboard' as PanelId,
    labelKey: 'panel.taskboard' as PersonalizationKey,
    exists: () => document.querySelector('[data-dsh-taskboard-view]') !== null,
  }),
  Object.freeze({
    id: 'ssh' as PanelId,
    labelKey: 'panel.ssh' as PersonalizationKey,
    exists: () => document.querySelector('[data-dsh-ssh-view]') !== null,
  }),
])

/** The panels currently present in the DOM. */
export function detectPanels(): readonly PanelInfo[] {
  return PANEL_REGISTRY.filter(panel => panel.exists())
}
