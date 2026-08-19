/**
 * Character-theme layer, shared by both halves: pure functions that manage the
 * theme library over a config document.
 *
 * Model: exactly one theme is effective at a time. Activating a theme first
 * undoes the previous active theme (restores the appearance snapshot captured
 * when that theme was activated), then captures the current appearance as the
 * new theme's snapshot and overlays the theme's patch. Deactivating restores
 * the active theme's snapshot — turning theming off returns exactly to the
 * pre-theme look. Switching A→B therefore replaces A's look with B's; switching
 * back to A re-applies A's patch over the restored pre-theme appearance.
 *
 * Consequence (documented limitation): manual knob edits made while a theme is
 * active are not saved with the theme; deactivating or switching away restores
 * the appearance from the moment the theme was activated.
 *
 * Environment-agnostic: no `window`, no Node built-ins — both bundles inline
 * this module. The engine itself needs no changes: activation bakes the theme
 * overlay into `base`/`panels`/`globalBackground`/`chrome`, which the engine
 * already styles.
 */
import type {
  AppearanceSections,
  CharacterTheme,
  CharacterThemePatch,
  PaletteSeeds,
  PersonalizationConfig,
} from './config.ts'
import { deepMerge } from './patch.ts'

/** The styling decisions a character theme carries (validated tool input). */
export interface ThemeStyleInput {
  /** Custom accent hex (#rrggbb); null clears it. */
  accent?: string | null
  /** Accent palette preset id. */
  preset?: string
  /**
   * Full palette seeds: when set, the engine derives the whole `--dsw-static-*`
   * ramp from these instead of the preset/accent fallbacks.
   */
  seeds?: PaletteSeeds | null
  /** The scheme the seeds were derived for (pins the UI when non-null). */
  appearance?: 'light' | 'dark' | null
  /** Typography preset id. */
  font?: string
  /** Panel transparency 0..0.9. */
  transparency?: number
  /** Restyle the scrollbar. */
  scrollbar?: boolean
  /** Text-selection color, or null to clear it. */
  selection?: string | null
  /** Use the character art as the page-wide backdrop. */
  useBackground?: boolean
  /** Scrim alpha over the backdrop image, 0..1. */
  scrim?: number
  /** Use the character art as the favicon. */
  useFavicon?: boolean
  /** Page title override (the character name, typically). */
  title?: string
}

/** Clone a config and run a mutating recipe on the clone (purity helper). */
function withClone(config: PersonalizationConfig, recipe: (next: PersonalizationConfig) => void): PersonalizationConfig {
  const next = structuredClone(config) as PersonalizationConfig
  recipe(next)
  return next
}

/** Replace the appearance sections in `next` with `sections` (snapshot restore). */
function restoreAppearance(next: PersonalizationConfig, sections: AppearanceSections): void {
  next.base = structuredClone(sections.base)
  next.panels = structuredClone(sections.panels)
  next.globalBackground = structuredClone(sections.globalBackground)
  next.chrome = structuredClone(sections.chrome)
}

/** Overlay a theme patch on the appearance sections of `next`. */
function overlayPatch(next: PersonalizationConfig, patch: CharacterThemePatch): void {
  const merged = deepMerge({
    base: next.base,
    panels: next.panels,
    globalBackground: next.globalBackground,
    chrome: next.chrome,
  }, patch)
  next.base = merged.base as PersonalizationConfig['base']
  next.panels = merged.panels as PersonalizationConfig['panels']
  next.globalBackground = merged.globalBackground as PersonalizationConfig['globalBackground']
  next.chrome = merged.chrome as PersonalizationConfig['chrome']
}

/** The current appearance sections (deep copy) — a theme's snapshot source. */
export function captureAppearance(config: PersonalizationConfig): AppearanceSections {
  return structuredClone({
    base: config.base,
    panels: config.panels,
    globalBackground: config.globalBackground,
    chrome: config.chrome,
  })
}

/** Look up a theme by exact id or name (case-sensitive name match). */
export function findTheme(config: PersonalizationConfig, idOrName: string): CharacterTheme | undefined {
  const key = idOrName.trim()
  if (key === '') return undefined
  return config.themes.list.find(theme => theme.id === key || theme.name === key)
}

/** The currently active theme, or undefined. */
export function activeTheme(config: PersonalizationConfig): CharacterTheme | undefined {
  const id = config.themes.active
  return id === null ? undefined : config.themes.list.find(theme => theme.id === id)
}

/**
 * Build the appearance patch a theme applies from validated styling decisions.
 * `undefined` fields leave the corresponding knob untouched; `null` clears.
 * @param input - the validated styling decisions.
 * @param sourceImage - the stored character-art asset ref (used for the
 * backdrop when `useBackground` and for the favicon when `useFavicon`).
 */
export function buildThemePatch(input: ThemeStyleInput, sourceImage: string | null = null): CharacterThemePatch {
  const patch: CharacterThemePatch = {}
  const base: NonNullable<CharacterThemePatch['base']> = {}
  if (input.accent !== undefined || input.preset !== undefined
    || input.seeds !== undefined || input.appearance !== undefined) {
    const palette: NonNullable<NonNullable<CharacterThemePatch['base']>['palette']> = {}
    if (input.seeds !== undefined) {
      // Seeds replace the preset/accent fallbacks wholesale.
      palette.seeds = input.seeds
      palette.preset = ''
      palette.accent = null
      if (input.appearance !== undefined) palette.appearance = input.appearance
      if (input.seeds === null) palette.appearance = null
    } else {
      // preset/accent (or a lone appearance) always clear any seeds.
      palette.seeds = null
      palette.appearance = null
      if (input.accent !== undefined) {
        palette.accent = input.accent
        if (input.accent !== null) palette.preset = ''
      }
      if (input.preset !== undefined) {
        palette.preset = input.preset
        if (palette.accent === undefined) palette.accent = null
      }
    }
    base.palette = palette
  }
  if (input.transparency !== undefined) base.glass = { opacity: input.transparency }
  if (input.font !== undefined) base.font = { family: input.font }
  if (input.scrollbar !== undefined) base.scrollbar = input.scrollbar
  if (input.selection !== undefined) base.selection = input.selection
  if (Object.keys(base).length > 0) patch.base = base
  if (input.useBackground === true) {
    patch.globalBackground = { image: sourceImage, scrim: input.scrim ?? 0.25 }
  }
  if (input.useFavicon === true || input.title !== undefined) {
    const chrome: NonNullable<CharacterThemePatch['chrome']> = {}
    if (input.useFavicon === true) chrome.favicon = sourceImage
    if (input.title !== undefined) chrome.title = input.title
    patch.chrome = chrome
  }
  return patch
}

/**
 * Activate (or re-apply) a theme: undo the previous active theme, capture the
 * pre-theme appearance as the new snapshot, overlay the patch, and mark the
 * theme active. The theme is upserted into the library (keyed by id). The
 * caller supplies a draft without `snapshot` — it is captured here.
 */
export function activateTheme(config: PersonalizationConfig, theme: Omit<CharacterTheme, 'snapshot'>): PersonalizationConfig {
  return withClone(config, (next) => {
    const previous = activeTheme(next)
    if (previous !== undefined && previous.snapshot !== null) {
      restoreAppearance(next, previous.snapshot)
    }
    const snapshot = captureAppearance(next)
    overlayPatch(next, theme.patch)
    next.themes = {
      active: theme.id,
      list: [...next.themes.list.filter(item => item.id !== theme.id), { ...theme, snapshot }],
    }
  })
}

/** Deactivate the active theme: restore its snapshot and clear `active`. */
export function deactivateTheme(config: PersonalizationConfig): PersonalizationConfig {
  return withClone(config, (next) => {
    const current = activeTheme(next)
    if (current !== undefined && current.snapshot !== null) {
      restoreAppearance(next, current.snapshot)
    }
    next.themes = { active: null, list: next.themes.list }
  })
}

/**
 * Remove a theme from the library. Removing the active theme deactivates it
 * first (restoring its snapshot). Returns the config unchanged when the theme
 * is not found.
 */
export function removeTheme(config: PersonalizationConfig, idOrName: string): PersonalizationConfig {
  const theme = findTheme(config, idOrName)
  if (theme === undefined) return config
  return withClone(config, (next) => {
    if (next.themes.active === theme.id) {
      if (theme.snapshot !== null) restoreAppearance(next, theme.snapshot)
      next.themes.active = null
    }
    next.themes.list = next.themes.list.filter(item => item.id !== theme.id)
  })
}
