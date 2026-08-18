/**
 * Personalization configuration model and browser-local persistence.
 *
 * The config lives in localStorage under a single versioned key (same
 * convention as the dsh-web-ui family plugins, e.g. task-board's
 * `dsh.taskBoard.v1`). This is deliberate: the user asked for settings that
 * survive a restart of `dsh web` on the same machine/browser but do NOT
 * follow them to another machine. localStorage is exactly that scope — the
 * browser profile, not the host — and needs no host-side route or settings
 * namespace (which would require a WEB_SETTINGS_NAMESPACES whitelist patch).
 *
 * Panel-level personalization: every detectable surface (the official shell
 * plus third-party plugin panels) owns a `PanelFollowConfig` in `panels`.
 * The settings page edits one panel at a time, or "all" as a baseline
 * appearance (`base`) that every follow knob inherits from — a panel shows a
 * baseline value only while its knob follows it.
 */

/** localStorage key holding the whole configuration document. */
export const STORAGE_KEY = 'dsh.personalization.v1'

/**
 * A detectable surface the personalization can restyle independently. The
 * three official columns are separate panels (their token overrides are
 * scoped to each column), and every third-party surface joins the registry
 * with its own container selector.
 */
export type PanelId =
  | 'sidebar'
  | 'conversation'
  | 'details'
  | 'aionui'
  | 'taskboard'
  | 'ssh'

/** Every known panel, in display order (existence is probed at runtime). */
export const PANEL_IDS: readonly PanelId[] = Object.freeze([
  'sidebar',
  'conversation',
  'details',
  'aionui',
  'taskboard',
  'ssh',
])

/** A panel background: either a solid base color or a backdrop image. */
export interface PanelBackgroundSettings {
  /** 'solid' paints the panel's base color (no backdrop); 'image' shows an image. */
  mode: 'solid' | 'image'
  /** Backdrop image data URL (used when mode === 'image'). */
  image: string | null
  /** Scrim alpha over the image, 0..1. */
  scrim: number
}

/** The appearance knobs one panel owns (the official token group it consumes). */
export interface PanelConfig {
  /**
   * Panel transparency 0..0.9: how much the backdrop image shows through.
   * Only meaningful while the background mode is 'image' — a solid panel
   * paints its base color opaquely, so the slider is inert there.
   */
  glass: {
    opacity: number
  }
  /** Accent/palette selection: a preset id or a custom hex accent. */
  palette: {
    /** Selected preset id; '' means "use custom accent or none". */
    preset: string
    /** Custom accent hex (#rrggbb), overrides preset when set. */
    accent: string | null
  }
  /** Typography: font-family role selection. */
  font: {
    /** 'default' | 'rounded' | 'serif' | 'mono' — or a raw stack for custom. */
    family: string
    /** Raw custom stack; wins over `family` when non-empty. */
    custom: string
  }
  /** Restyle the scrollbar. */
  scrollbar: boolean
  /** Text-selection color, or null for the default. */
  selection: string | null
  /** Background settings: solid color (default) or a backdrop image. */
  background: PanelBackgroundSettings
}

/**
 * A per-panel appearance knob that can either follow the "all panels"
 * baseline (`follow: true` — the value is inherited and the knob is not
 * editable) or carry its own independent value.
 */
export interface PanelFollowConfig {
  glass: { follow: boolean; opacity: number }
  palette: { follow: boolean; preset: string; accent: string | null }
  font: { follow: boolean; family: string; custom: string }
  scrollbar: { follow: boolean; value: boolean }
  selection: { follow: boolean; value: string | null }
  background: { follow: boolean; mode: 'solid' | 'image'; image: string | null; scrim: number }
}

/** Default per-panel appearance (the official look untouched). */
export const DEFAULT_PANEL_CONFIG: PanelConfig = Object.freeze({
  glass: { opacity: 0.55 },
  palette: { preset: '', accent: null },
  font: { family: 'default', custom: '' },
  scrollbar: false,
  selection: null,
  background: { mode: 'solid' as const, image: null, scrim: 0.25 },
})

/** Default per-panel config: every knob follows the baseline. */
export function defaultFollowConfig(): PanelFollowConfig {
  return structuredClone({
    glass: { follow: true, opacity: 0.55 },
    palette: { follow: true, preset: '', accent: null },
    font: { follow: true, family: 'default', custom: '' },
    scrollbar: { follow: true, value: false },
    selection: { follow: true, value: null },
    background: { follow: true, mode: 'solid', image: null, scrim: 0.25 },
  }) as PanelFollowConfig
}

/**
 * Resolve a panel's effective appearance: follow knobs inherit the baseline,
 * independent knobs keep their own values.
 * @param base - the "all panels" baseline appearance.
 * @param follow - the panel's follow config.
 * @returns the effective PanelConfig the engine styles.
 */
export function resolvePanelConfig(base: PanelConfig, follow: PanelFollowConfig): PanelConfig {
  return {
    glass: { opacity: follow.glass.follow ? base.glass.opacity : follow.glass.opacity },
    palette: follow.palette.follow
      ? structuredClone(base.palette)
      : { preset: follow.palette.preset, accent: follow.palette.accent },
    font: follow.font.follow
      ? structuredClone(base.font)
      : { family: follow.font.family, custom: follow.font.custom },
    scrollbar: follow.scrollbar.follow ? base.scrollbar : follow.scrollbar.value,
    selection: follow.selection.follow ? base.selection : follow.selection.value,
    background: follow.background.follow
      ? structuredClone(base.background)
      : { mode: follow.background.mode, image: follow.background.image, scrim: follow.background.scrim },
  }
}

/** The persisted configuration document. */
export interface PersonalizationConfig {
  /** Master switch: false retracts every personalization write. */
  enabled: boolean
  /**
   * Page-wide backdrop (bottom layer, rendered on body) — independent of the
   * per-panel background settings. Panel backdrops stack over it.
   */
  globalBackground: {
    /** Page-wide compressed data URL, or null for none. */
    image: string | null
    /** Page-wide scrim alpha over the image, 0..1. */
    scrim: number
  }
  /** Page chrome: favicon and title — page-global. */
  chrome: {
    /** Favicon image data URL, or null for the default. */
    favicon: string | null
    /** Document title override, or null for the default. */
    title: string | null
  }
  /** The "all panels" baseline appearance (the follow knobs inherit from). */
  base: PanelConfig
  /** One follow-capable appearance config per detectable panel. */
  panels: Record<PanelId, PanelFollowConfig>
}

/** Default configuration (the page look untouched). */
function defaultPanels(): Record<PanelId, PanelFollowConfig> {
  const panels = {} as Record<PanelId, PanelFollowConfig>
  for (const id of PANEL_IDS) {
    panels[id] = defaultFollowConfig()
  }
  return panels
}

export const DEFAULT_CONFIG: PersonalizationConfig = Object.freeze({
  enabled: true,
  globalBackground: { image: null, scrim: 0.25 },
  chrome: { favicon: null, title: null },
  base: structuredClone(DEFAULT_PANEL_CONFIG) as PanelConfig,
  panels: Object.freeze(defaultPanels()),
})

/** Sanitize one panel appearance value. */
function sanitizePanelConfig(raw: unknown): PanelConfig {
  const base = structuredClone(DEFAULT_PANEL_CONFIG) as PanelConfig
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  if (typeof r.glass === 'object' && r.glass !== null) {
    const g = r.glass as Record<string, unknown>
    if (typeof g.opacity === 'number') base.glass.opacity = Math.min(0.9, Math.max(0, g.opacity))
  }
  if (typeof r.palette === 'object' && r.palette !== null) {
    const p = r.palette as Record<string, unknown>
    if (typeof p.preset === 'string') base.palette.preset = p.preset
    if (typeof p.accent === 'string') base.palette.accent = p.accent
  }
  if (typeof r.font === 'object' && r.font !== null) {
    const f = r.font as Record<string, unknown>
    if (typeof f.family === 'string') base.font.family = f.family
    if (typeof f.custom === 'string') base.font.custom = f.custom
  }
  if (typeof r.scrollbar === 'boolean') base.scrollbar = r.scrollbar
  if (typeof r.selection === 'string') base.selection = r.selection
  if (typeof r.background === 'object' && r.background !== null) {
    const b = r.background as Record<string, unknown>
    if (b.mode === 'image') base.background.mode = 'image'
    if (typeof b.image === 'string') base.background.image = b.image
    if (typeof b.scrim === 'number') base.background.scrim = Math.min(1, Math.max(0, b.scrim))
  }
  return base
}

/** Wrap an old independent PanelConfig into a follow config (follow = false). */
function followFromPanel(pc: PanelConfig): PanelFollowConfig {
  return {
    glass: { follow: false, opacity: pc.glass.opacity },
    palette: { follow: false, preset: pc.palette.preset, accent: pc.palette.accent },
    font: { follow: false, family: pc.font.family, custom: pc.font.custom },
    scrollbar: { follow: false, value: pc.scrollbar },
    selection: { follow: false, value: pc.selection },
    background: { follow: false, mode: pc.background.mode, image: pc.background.image, scrim: pc.background.scrim },
  }
}

/** Sanitize one follow-capable panel appearance value. */
function sanitizeFollowConfig(raw: unknown): PanelFollowConfig {
  const base = defaultFollowConfig()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  if (typeof r.glass === 'object' && r.glass !== null) {
    const g = r.glass as Record<string, unknown>
    if (typeof g.follow === 'boolean') base.glass.follow = g.follow
    if (typeof g.opacity === 'number') base.glass.opacity = Math.min(0.9, Math.max(0, g.opacity))
  }
  if (typeof r.palette === 'object' && r.palette !== null) {
    const p = r.palette as Record<string, unknown>
    if (typeof p.follow === 'boolean') base.palette.follow = p.follow
    if (typeof p.preset === 'string') base.palette.preset = p.preset
    if (typeof p.accent === 'string') base.palette.accent = p.accent
  }
  if (typeof r.font === 'object' && r.font !== null) {
    const f = r.font as Record<string, unknown>
    if (typeof f.follow === 'boolean') base.font.follow = f.follow
    if (typeof f.family === 'string') base.font.family = f.family
    if (typeof f.custom === 'string') base.font.custom = f.custom
  }
  if (typeof r.scrollbar === 'object' && r.scrollbar !== null) {
    const s = r.scrollbar as Record<string, unknown>
    if (typeof s.follow === 'boolean') base.scrollbar.follow = s.follow
    if (typeof s.value === 'boolean') base.scrollbar.value = s.value
  } else if (typeof r.scrollbar === 'boolean') {
    base.scrollbar = { follow: false, value: r.scrollbar }
  }
  if (typeof r.selection === 'object' && r.selection !== null) {
    const s = r.selection as Record<string, unknown>
    if (typeof s.follow === 'boolean') base.selection.follow = s.follow
    if (typeof s.value === 'string') base.selection.value = s.value
  } else if (typeof r.selection === 'string') {
    base.selection = { follow: false, value: r.selection }
  }
  if (typeof r.background === 'object' && r.background !== null) {
    const b = r.background as Record<string, unknown>
    if (typeof b.follow === 'boolean') base.background.follow = b.follow
    if (b.mode === 'solid' || b.mode === 'image') base.background.mode = b.mode
    if (typeof b.image === 'string') base.background.image = b.image
    if (typeof b.scrim === 'number') base.background.scrim = Math.min(1, Math.max(0, b.scrim))
  }
  return base
}

/** Sanitize an unknown persisted value into a full config document. */
export function sanitizeConfig(raw: unknown): PersonalizationConfig {
  const base = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  if (typeof r.enabled === 'boolean') base.enabled = r.enabled
  // The page-wide backdrop, independent of per-panel backgrounds.
  if (typeof r.globalBackground === 'object' && r.globalBackground !== null) {
    const g = r.globalBackground as Record<string, unknown>
    if (typeof g.image === 'string') base.globalBackground.image = g.image
    if (typeof g.scrim === 'number') base.globalBackground.scrim = Math.min(1, Math.max(0, g.scrim))
  }
  // Legacy page-level background: a page-wide image and/or per-panel entries.
  // The page-wide image becomes the page-wide backdrop; the per-panel
  // three-state entries fold into each panel's background knob.
  let legacyGlobalImage: { image: string; scrim: number } | null = null
  const legacyPanelBackgrounds = new Map<PanelId, { mode: string; image: string | null; scrim: number }>()
  if (typeof r.background === 'object' && r.background !== null) {
    const b = r.background as Record<string, unknown>
    if (typeof b.image === 'string') {
      legacyGlobalImage = {
        image: b.image,
        scrim: typeof b.scrim === 'number' ? Math.min(1, Math.max(0, b.scrim)) : 0.25,
      }
    }
    if (typeof b.panels === 'object' && b.panels !== null) {
      const pb = b.panels as Record<string, unknown>
      for (const id of PANEL_IDS) {
        const entry = pb[id]
        if (typeof entry !== 'object' || entry === null) continue
        const e = entry as Record<string, unknown>
        const scrim = typeof e.scrim === 'number' ? Math.min(1, Math.max(0, e.scrim)) : 0.25
        if (typeof e.mode === 'string' && (e.mode === 'follow' || e.mode === 'custom' || e.mode === 'none')) {
          legacyPanelBackgrounds.set(id, {
            mode: e.mode,
            image: typeof e.image === 'string' ? e.image : null,
            scrim,
          })
        } else if (typeof e.image === 'string') {
          legacyPanelBackgrounds.set(id, {
            mode: typeof e.follow === 'boolean' && e.follow ? 'follow' : 'custom',
            image: e.image,
            scrim,
          })
        }
      }
    }
  }
  if (typeof r.chrome === 'object' && r.chrome !== null) {
    const c = r.chrome as Record<string, unknown>
    if (typeof c.favicon === 'string') base.chrome.favicon = c.favicon
    if (typeof c.title === 'string') base.chrome.title = c.title
  }
  // The "all panels" baseline; older documents have no base and derive it
  // from the legacy flat knobs below.
  if (typeof r.base === 'object' && r.base !== null) {
    base.base = sanitizePanelConfig(r.base)
  }
  // The legacy page-wide image becomes the page-wide backdrop (bottom layer),
  // unless a newer globalBackground entry already provided one.
  if (legacyGlobalImage !== null && base.globalBackground.image === null) {
    base.globalBackground = { image: legacyGlobalImage.image, scrim: legacyGlobalImage.scrim }
  }
  // Per-panel appearance dictionary.
  if (typeof r.panels === 'object' && r.panels !== null) {
    const p = r.panels as Record<string, unknown>
    for (const id of PANEL_IDS) {
      const entry = p[id]
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as Record<string, unknown>
      // A selection object marks the new follow shape; anything else is the
      // old independent PanelConfig shape and migrates to follow = false.
      base.panels[id] = typeof e.selection === 'object' && e.selection !== null
        ? sanitizeFollowConfig(e)
        : followFromPanel(sanitizePanelConfig(e))
    }
  } else {
    // Legacy documents stored flat top-level knobs plus a third-party scope
    // selector; fold them into the baseline and per-panel configs. The old
    // `builtin` panel was the whole official shell, so its value seeds the
    // three official columns; the aionui panel follows only when the legacy
    // scope included it. Panels the legacy document never named keep their
    // defaults (follow = true).
    const legacy = (): PanelConfig => ({
      glass: { opacity: typeof r.glass === 'object' && r.glass !== null
        && typeof (r.glass as Record<string, unknown>).opacity === 'number'
        ? Math.min(0.9, Math.max(0, (r.glass as Record<string, unknown>).opacity as number)) : 0.55 },
      palette: typeof r.palette === 'object' && r.palette !== null
        ? {
          preset: typeof (r.palette as Record<string, unknown>).preset === 'string'
            ? (r.palette as Record<string, unknown>).preset as string : '',
          accent: typeof (r.palette as Record<string, unknown>).accent === 'string'
            ? (r.palette as Record<string, unknown>).accent as string : null,
        }
        : { preset: '', accent: null },
      font: typeof r.font === 'object' && r.font !== null
        ? {
          family: typeof (r.font as Record<string, unknown>).family === 'string'
            ? (r.font as Record<string, unknown>).family as string : 'default',
          custom: typeof (r.font as Record<string, unknown>).custom === 'string'
            ? (r.font as Record<string, unknown>).custom as string : '',
        }
        : { family: 'default', custom: '' },
      scrollbar: typeof r.scrollbar === 'boolean' ? r.scrollbar : false,
      selection: typeof r.selection === 'string' ? r.selection : null,
      background: { mode: 'solid', image: null, scrim: 0.25 },
    })
    base.base = legacy()
    for (const id of ['sidebar', 'conversation', 'details'] as const) {
      base.panels[id] = followFromPanel(legacy())
    }
    const thirdParty = r.thirdParty === 'all'
      || (Array.isArray(r.thirdParty) && r.thirdParty.includes('aionui'))
      || r.includeThirdParty === true
    base.panels.aionui = thirdParty
      ? followFromPanel(legacy())
      : defaultFollowConfig()
  }
  // Fold the legacy per-panel three-state entries into each panel's
  // background knob (custom → own image; follow/none → follow or solid).
  for (const [id, entry] of legacyPanelBackgrounds) {
    const panel = base.panels[id]
    if (entry.mode === 'custom' && entry.image !== null) {
      panel.background = { follow: false, mode: 'image', image: entry.image, scrim: entry.scrim }
    } else if (entry.mode === 'follow') {
      panel.background = { follow: true, mode: 'solid', image: null, scrim: entry.scrim }
    } else {
      panel.background = { follow: false, mode: 'solid', image: null, scrim: entry.scrim }
    }
  }
  return base
}

/** Read and sanitize the persisted configuration. */
export function loadConfig(): PersonalizationConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? structuredClone(DEFAULT_CONFIG) as PersonalizationConfig : sanitizeConfig(JSON.parse(raw))
  } catch {
    return structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  }
}

/** Persist a configuration document. */
export function saveConfig(config: PersonalizationConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Quota exceeded or storage disabled: the in-memory config still applies
    // for this page lifetime; persistence silently degrades.
  }
}
