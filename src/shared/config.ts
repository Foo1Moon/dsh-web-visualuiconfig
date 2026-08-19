/**
 * Personalization configuration model shared by the host half (lib/index.js)
 * and the browser half (lib/client.js). Environment-agnostic: no `window`,
 * no `localStorage`, no Node built-ins — both bundles inline this module.
 *
 * The host half sanitizes every stored/uploaded document through
 * {@link sanitizeConfig} before persisting; the browser half sanitizes on
 * read. `storageMode` decides where the config lives: 'host' (the machine
 * file under ~/.dsh, the default) or 'browser' (localStorage only).
 */

/** Where the configuration document is persisted. */
export type StorageMode = 'browser' | 'host'

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

/** Wallpaper display mode: how the backdrop image fits its area. */
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'tile'

/** The accepted fit ids. */
export const BACKGROUND_FITS: readonly BackgroundFit[] = Object.freeze(['cover', 'contain', 'stretch', 'tile'])

/** A panel background: either a solid base color or a backdrop image. */
export interface PanelBackgroundSettings {
  /** 'solid' paints the panel's base color (no backdrop); 'image' shows an image. */
  mode: 'solid' | 'image'
  /** Backdrop image: a data URL, or an `asset:<sha256>.<ext>` host ref (used when mode === 'image'). */
  image: string | null
  /** Scrim alpha over the image, 0..1. */
  scrim: number
  /** How the image fits the panel area (only when mode === 'image'). */
  fit: BackgroundFit
}

/**
 * The four seed colours a whole palette is derived from (OKLab contrast-
 * preserving derivation, see src/shared/derive.ts): accent + secondary are the
 * two voices, surface is the page background (used verbatim), text anchors the
 * far end of the neutral ramp.
 */
export interface PaletteSeeds {
  /** The skin's voice: chat bubbles, the active sidebar item, the titlebar band. */
  accent: string
  /** The second voice: focus outlines, titlebar edges. */
  secondary: string
  /** The page background, used verbatim; every neutral step is solved against it. */
  surface: string
  /** Anchors the far end of the neutral ramp; hue and chroma survive. */
  text: string
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
  /** Accent/palette selection: a preset id, a custom hex accent, or seeds. */
  palette: {
    /** Selected preset id; '' means "use seeds/accent/none". */
    preset: string
    /** Custom accent hex (#rrggbb), overrides preset when set. */
    accent: string | null
    /**
     * Full palette seeds (character themes). When set, the engine derives the
     * whole `--dsw-static-*` ramp from these instead of the preset/accent
     * fallbacks. Mutually exclusive with preset/accent (setting one clears the
     * others).
     */
    seeds: PaletteSeeds | null
    /**
     * The colour scheme the seeds were derived for. Non-null pins the UI to
     * that scheme while the seeds are active; null derives both schemes.
     */
    appearance: 'light' | 'dark' | null
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
  palette: { follow: boolean; preset: string; accent: string | null; seeds: PaletteSeeds | null; appearance: 'light' | 'dark' | null }
  font: { follow: boolean; family: string; custom: string }
  scrollbar: { follow: boolean; value: boolean }
  selection: { follow: boolean; value: string | null }
  background: { follow: boolean; mode: 'solid' | 'image'; image: string | null; scrim: number; fit: BackgroundFit }
}

/** Default per-panel appearance (the official look untouched). */
export const DEFAULT_PANEL_CONFIG: PanelConfig = Object.freeze({
  glass: { opacity: 0.55 },
  palette: { preset: '', accent: null, seeds: null, appearance: null },
  font: { family: 'default', custom: '' },
  scrollbar: false,
  selection: null,
  background: { mode: 'solid' as const, image: null, scrim: 0.25, fit: 'cover' as const },
})

/** Default per-panel config: every knob follows the baseline. */
export function defaultFollowConfig(): PanelFollowConfig {
  return structuredClone({
    glass: { follow: true, opacity: 0.55 },
    palette: { follow: true, preset: '', accent: null, seeds: null, appearance: null },
    font: { follow: true, family: 'default', custom: '' },
    scrollbar: { follow: true, value: false },
    selection: { follow: true, value: null },
    background: { follow: true, mode: 'solid', image: null, scrim: 0.25, fit: 'cover' },
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
      : {
        preset: follow.palette.preset,
        accent: follow.palette.accent,
        seeds: follow.palette.seeds === null ? null : structuredClone(follow.palette.seeds),
        appearance: follow.palette.appearance,
      },
    font: follow.font.follow
      ? structuredClone(base.font)
      : { family: follow.font.family, custom: follow.font.custom },
    scrollbar: follow.scrollbar.follow ? base.scrollbar : follow.scrollbar.value,
    selection: follow.selection.follow ? base.selection : follow.selection.value,
    background: follow.background.follow
      ? structuredClone(base.background)
      : { mode: follow.background.mode, image: follow.background.image, scrim: follow.background.scrim, fit: follow.background.fit },
  }
}

/**
 * The appearance sections a character theme may drive. A theme overlays these
 * sections; deactivating it restores the snapshot captured at activation.
 */
export interface AppearanceSections {
  /** The "all panels" baseline appearance. */
  base: PanelConfig
  /** One follow-capable appearance config per detectable panel. */
  panels: Record<PanelId, PanelFollowConfig>
  /** Page-wide backdrop. */
  globalBackground: { image: string | null; scrim: number; fit: BackgroundFit; blur: number }
  /** Page chrome: favicon and title. */
  chrome: { favicon: string | null; title: string | null; statusText: string }
}

/** The appearance patch a character theme applies (a partial overlay). */
export interface CharacterThemePatch {
  base?: {
    glass?: { opacity?: number }
    palette?: {
      preset?: string
      accent?: string | null
      seeds?: PaletteSeeds | null
      appearance?: 'light' | 'dark' | null
    }
    font?: { family?: string; custom?: string }
    scrollbar?: boolean
    selection?: string | null
    background?: { mode?: 'solid' | 'image'; image?: string | null; scrim?: number; fit?: BackgroundFit }
  }
  /** Optional per-panel overrides (a theme normally drives the baseline). */
  panels?: Partial<Record<PanelId, Partial<PanelFollowConfig>>>
  globalBackground?: { image?: string | null; scrim?: number; fit?: BackgroundFit; blur?: number }
  chrome?: { favicon?: string | null; title?: string | null; statusText?: string }
}

/** One saved character theme in the library. */
export interface CharacterTheme {
  /** Stable id (derived from the name; see {@link themeIdFromName}). */
  id: string
  /** Display name (usually the character name); the natural key for lookups. */
  name: string
  /** The character's introduction (truncated). */
  description: string
  /** Character art asset ref (`asset:<sha256>.<ext>`), or null. */
  sourceImage: string | null
  /**
   * The palette seeds derived from the character (mirrored into
   * `patch.base.palette.seeds` when the theme carries them), kept here for
   * tooling/UI display.
   */
  seeds?: PaletteSeeds
  /** The scheme the seeds were derived for, when the theme pins one. */
  appearance?: 'light' | 'dark'
  /** Creation timestamp (ms). */
  createdAt: number
  /** The appearance patch this theme applies when activated. */
  patch: CharacterThemePatch
  /**
   * Appearance captured when the theme was activated, restored when the theme
   * is deactivated or switched away — so one theme is effective at a time and
   * turning theming off returns exactly to the pre-theme look.
   */
  snapshot: AppearanceSections | null
}

/** The character theme library: one active overlay + a saved list. */
export interface CharacterThemeRegistry {
  /** Currently active theme id, or null (theming off). */
  active: string | null
  /** Every saved theme, in creation order. */
  list: CharacterTheme[]
}

/** The persisted configuration document. */
export interface PersonalizationConfig {
  /** Where the document is persisted: the machine file (default) or localStorage only. */
  storageMode: StorageMode
  /** Master switch: false retracts every personalization write. */
  enabled: boolean
  /**
   * Page-wide backdrop (bottom layer, rendered on body) — independent of the
   * per-panel background settings. Panel backdrops stack over it.
   */
  globalBackground: {
    /** Page-wide image (data URL or `asset:` ref), or null for none. */
    image: string | null
    /** Page-wide scrim alpha over the image, 0..1. */
    scrim: number
    /** How the image fits the viewport. */
    fit: BackgroundFit
    /** Gaussian blur radius on the backdrop layer, 0..60px (safe: the blur
     *  lives on the standalone fixed backdrop element, never a column). */
    blur: number
  }
  /** Page chrome: favicon, title and the running-turn status text. */
  chrome: {
    /** Favicon image (data URL or `asset:` ref), or null for the default. */
    favicon: string | null
    /** Document title override, or null for the default. */
    title: string | null
    /**
     * Running-turn status text shown next to the elapsed clock while a turn
     * is running (replaces the official "Deep diving..."). '' keeps the
     * official label. Injected via a DOM observer over the official
     * `[role="status"]` element — upstream hard-codes the label with no seam.
     */
    statusText: string
  }
  /** The "all panels" baseline appearance (the follow knobs inherit from). */
  base: PanelConfig
  /** One follow-capable appearance config per detectable panel. */
  panels: Record<PanelId, PanelFollowConfig>
  /** The character theme library (see src/shared/theme.ts). */
  themes: CharacterThemeRegistry
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
  storageMode: 'host',
  enabled: true,
  globalBackground: { image: null, scrim: 0.25, fit: 'cover' as const, blur: 0 },
  chrome: { favicon: null, title: null, statusText: '' },
  base: structuredClone(DEFAULT_PANEL_CONFIG) as PanelConfig,
  panels: Object.freeze(defaultPanels()),
  themes: Object.freeze({ active: null, list: [] }),
})

/** Sanitize one palette-seeds value: four hex colours, or null. */
function sanitizePaletteSeeds(raw: unknown): PaletteSeeds | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  const pick = (key: string): string | null =>
    typeof s[key] === 'string' && /^#[0-9a-f]{6}$/i.test(s[key] as string)
      ? (s[key] as string).toLowerCase()
      : null
  const accent = pick('accent')
  const secondary = pick('secondary')
  const surface = pick('surface')
  const text = pick('text')
  if (accent === null || secondary === null || surface === null || text === null) return null
  return { accent, secondary, surface, text }
}

/** Coerce a raw value into a known fit id, 'cover' by default. */
function sanitizeFit(value: unknown): BackgroundFit {
  return BACKGROUND_FITS.includes(value as BackgroundFit) ? value as BackgroundFit : 'cover'
}

/** Coerce a raw value into a wallpaper blur radius, clamped 0..60px. */
function sanitizeBlur(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(60, Math.max(0, value)) : 0
}

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
    const seeds = sanitizePaletteSeeds(p.seeds)
    if (seeds !== null) base.palette.seeds = seeds
    if (p.appearance === 'light' || p.appearance === 'dark') base.palette.appearance = p.appearance
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
    base.background.fit = sanitizeFit(b.fit)
  }
  return base
}

/** Wrap an old independent PanelConfig into a follow config (follow = false). */
function followFromPanel(pc: PanelConfig): PanelFollowConfig {
  return {
    glass: { follow: false, opacity: pc.glass.opacity },
    palette: {
      follow: false,
      preset: pc.palette.preset,
      accent: pc.palette.accent,
      seeds: pc.palette.seeds === null ? null : structuredClone(pc.palette.seeds),
      appearance: pc.palette.appearance,
    },
    font: { follow: false, family: pc.font.family, custom: pc.font.custom },
    scrollbar: { follow: false, value: pc.scrollbar },
    selection: { follow: false, value: pc.selection },
    background: { follow: false, mode: pc.background.mode, image: pc.background.image, scrim: pc.background.scrim, fit: pc.background.fit },
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
    const seeds = sanitizePaletteSeeds(p.seeds)
    if (seeds !== null) base.palette.seeds = seeds
    if (p.appearance === 'light' || p.appearance === 'dark') base.palette.appearance = p.appearance
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
    base.background.fit = sanitizeFit(b.fit)
  }
  return base
}

/**
 * Derive a stable, ASCII-safe theme id from a display name. Deterministic (so
 * the id survives restarts and browser reloads) and collision-resistant enough
 * for a personal theme library; the name itself remains the natural key.
 */
export function themeIdFromName(name: string): string {
  const key = name.trim().toLowerCase()
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0
  }
  return `th-${hash.toString(36)}`
}

/** Sanitize one appearance patch field set (keeps known primitives only). */
function sanitizeThemePatch(raw: Record<string, unknown>): CharacterThemePatch {
  const out: CharacterThemePatch = {}
  const b = raw.base
  if (typeof b === 'object' && b !== null) {
    const br = b as Record<string, unknown>
    const base: NonNullable<CharacterThemePatch['base']> = {}
    const g = br.glass
    if (typeof g === 'object' && g !== null && typeof (g as Record<string, unknown>).opacity === 'number') {
      base.glass = { opacity: Math.min(0.9, Math.max(0, ((g as Record<string, unknown>).opacity as number))) }
    }
    const p = br.palette
    if (typeof p === 'object' && p !== null) {
      const pr = p as Record<string, unknown>
      const palette: NonNullable<NonNullable<CharacterThemePatch['base']>['palette']> = {}
      if (typeof pr.preset === 'string') palette.preset = pr.preset
      if (pr.accent === null || typeof pr.accent === 'string') palette.accent = pr.accent
      const seeds = sanitizePaletteSeeds(pr.seeds)
      if (seeds !== null) palette.seeds = seeds
      if (pr.appearance === 'light' || pr.appearance === 'dark') palette.appearance = pr.appearance
      if (Object.keys(palette).length > 0) base.palette = palette
    }
    const f = br.font
    if (typeof f === 'object' && f !== null) {
      const fr = f as Record<string, unknown>
      const font: NonNullable<NonNullable<CharacterThemePatch['base']>['font']> = {}
      if (typeof fr.family === 'string') font.family = fr.family
      if (typeof fr.custom === 'string') font.custom = fr.custom
      if (Object.keys(font).length > 0) base.font = font
    }
    if (typeof br.scrollbar === 'boolean') base.scrollbar = br.scrollbar
    if (br.selection === null || typeof br.selection === 'string') base.selection = br.selection
    const bg = br.background
    if (typeof bg === 'object' && bg !== null) {
      const bgr = bg as Record<string, unknown>
      const background: NonNullable<NonNullable<CharacterThemePatch['base']>['background']> = {}
      if (bgr.mode === 'solid' || bgr.mode === 'image') background.mode = bgr.mode
      if (bgr.image === null || typeof bgr.image === 'string') background.image = bgr.image
      if (typeof bgr.scrim === 'number') background.scrim = Math.min(1, Math.max(0, bgr.scrim))
      if (bgr.fit !== undefined) background.fit = sanitizeFit(bgr.fit)
      if (Object.keys(background).length > 0) base.background = background
    }
    if (Object.keys(base).length > 0) out.base = base
  }
  const gb = raw.globalBackground
  if (typeof gb === 'object' && gb !== null) {
    const gbr = gb as Record<string, unknown>
    const globalBackground: NonNullable<CharacterThemePatch['globalBackground']> = {}
    if (gbr.image === null || typeof gbr.image === 'string') globalBackground.image = gbr.image
    if (typeof gbr.scrim === 'number') globalBackground.scrim = Math.min(1, Math.max(0, gbr.scrim))
    if (gbr.fit !== undefined) globalBackground.fit = sanitizeFit(gbr.fit)
    if (gbr.blur !== undefined) globalBackground.blur = sanitizeBlur(gbr.blur)
    if (Object.keys(globalBackground).length > 0) out.globalBackground = globalBackground
  }
  const c = raw.chrome
  if (typeof c === 'object' && c !== null) {
    const cr = c as Record<string, unknown>
    const chrome: NonNullable<CharacterThemePatch['chrome']> = {}
    if (cr.favicon === null || typeof cr.favicon === 'string') chrome.favicon = cr.favicon
    if (cr.title === null || typeof cr.title === 'string') chrome.title = cr.title
    if (typeof cr.statusText === 'string') chrome.statusText = cr.statusText.slice(0, 64)
    if (Object.keys(chrome).length > 0) out.chrome = chrome
  }
  const panels = raw.panels
  if (typeof panels === 'object' && panels !== null) {
    const pr = panels as Record<string, unknown>
    const outPanels: NonNullable<CharacterThemePatch['panels']> = {}
    for (const id of PANEL_IDS) {
      const entry = pr[id]
      if (typeof entry !== 'object' || entry === null) continue
      outPanels[id] = entry as NonNullable<NonNullable<CharacterThemePatch['panels']>[PanelId]>
    }
    if (Object.keys(outPanels).length > 0) out.panels = outPanels
  }
  return out
}

/** Sanitize one saved character theme; null when the entry is unusable. */
function sanitizeTheme(raw: unknown): CharacterTheme | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim().slice(0, 64) : ''
  if (name === '') return null
  const id = typeof r.id === 'string' && /^[a-z0-9-]{1,64}$/i.test(r.id) ? r.id : themeIdFromName(name)
  const description = typeof r.description === 'string' ? r.description.slice(0, 2000) : ''
  const sourceImage = typeof r.sourceImage === 'string' ? r.sourceImage.slice(0, 4096) : null
  const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)
    ? Math.floor(r.createdAt)
    : Date.now()
  const patch = typeof r.patch === 'object' && r.patch !== null
    ? sanitizeThemePatch(r.patch as Record<string, unknown>)
    : {}
  const snapshot = typeof r.snapshot === 'object' && r.snapshot !== null
    ? sanitizeAppearanceSections(r.snapshot)
    : null
  const seeds = sanitizePaletteSeeds(r.seeds)
  const appearance = r.appearance === 'light' || r.appearance === 'dark' ? r.appearance : undefined
  const out: CharacterTheme = { id, name, description, sourceImage, createdAt, patch, snapshot }
  if (seeds !== null) out.seeds = seeds
  if (appearance !== undefined) out.appearance = appearance
  return out
}

/** Sanitize the appearance sections (theme snapshots). */
function sanitizeAppearanceSections(raw: unknown): AppearanceSections {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const panels = defaultPanels()
  const p = r.panels
  if (typeof p === 'object' && p !== null) {
    const pr = p as Record<string, unknown>
    for (const id of PANEL_IDS) {
      const entry = pr[id]
      if (typeof entry !== 'object' || entry === null) continue
      panels[id] = sanitizeFollowConfig(entry)
    }
  }
  const globalBackground = { image: null as string | null, scrim: 0.25, fit: 'cover' as BackgroundFit, blur: 0 }
  const gb = r.globalBackground
  if (typeof gb === 'object' && gb !== null) {
    const gbr = gb as Record<string, unknown>
    if (typeof gbr.image === 'string') globalBackground.image = gbr.image
    if (typeof gbr.scrim === 'number') globalBackground.scrim = Math.min(1, Math.max(0, gbr.scrim))
    globalBackground.fit = sanitizeFit(gbr.fit)
    globalBackground.blur = sanitizeBlur(gbr.blur)
  }
  const chrome = { favicon: null as string | null, title: null as string | null, statusText: '' }
  const c = r.chrome
  if (typeof c === 'object' && c !== null) {
    const cr = c as Record<string, unknown>
    if (typeof cr.favicon === 'string') chrome.favicon = cr.favicon
    if (typeof cr.title === 'string') chrome.title = cr.title
    if (typeof cr.statusText === 'string') chrome.statusText = cr.statusText.slice(0, 64)
  }
  return { base: sanitizePanelConfig(r.base), panels, globalBackground, chrome }
}

/** Sanitize an unknown persisted value into a full config document. */
export function sanitizeConfig(raw: unknown): PersonalizationConfig {
  const base = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Record<string, unknown>
  if (r.storageMode === 'browser' || r.storageMode === 'host') base.storageMode = r.storageMode
  if (typeof r.enabled === 'boolean') base.enabled = r.enabled
  // The page-wide backdrop, independent of per-panel backgrounds.
  if (typeof r.globalBackground === 'object' && r.globalBackground !== null) {
    const g = r.globalBackground as Record<string, unknown>
    if (typeof g.image === 'string') base.globalBackground.image = g.image
    if (typeof g.scrim === 'number') base.globalBackground.scrim = Math.min(1, Math.max(0, g.scrim))
    base.globalBackground.fit = sanitizeFit(g.fit)
    base.globalBackground.blur = sanitizeBlur(g.blur)
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
    if (typeof c.statusText === 'string') base.chrome.statusText = c.statusText.slice(0, 64)
  }
  // The "all panels" baseline; older documents have no base and derive it
  // from the legacy flat knobs below.
  if (typeof r.base === 'object' && r.base !== null) {
    base.base = sanitizePanelConfig(r.base)
  }
  // The legacy page-wide image becomes the page-wide backdrop (bottom layer),
  // unless a newer globalBackground entry already provided one.
  if (legacyGlobalImage !== null && base.globalBackground.image === null) {
    base.globalBackground = { image: legacyGlobalImage.image, scrim: legacyGlobalImage.scrim, fit: 'cover', blur: 0 }
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
  } else if (r.base === undefined || r.base === null) {
    // Legacy documents stored flat top-level knobs plus a third-party scope
    // selector; fold them into the baseline and per-panel configs. The old
    // `builtin` panel was the whole official shell, so its value seeds the
    // three official columns; the aionui panel follows only when the legacy
    // scope included it. Panels the legacy document never named keep their
    // defaults (follow = true). A document that carries a `base` but no
    // `panels` keeps that baseline and default follow configs instead.
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
          seeds: null,
          appearance: null,
        }
        : { preset: '', accent: null, seeds: null, appearance: null },
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
      background: { mode: 'solid', image: null, scrim: 0.25, fit: 'cover' },
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
      panel.background = { follow: false, mode: 'image', image: entry.image, scrim: entry.scrim, fit: 'cover' }
    } else if (entry.mode === 'follow') {
      panel.background = { follow: true, mode: 'solid', image: null, scrim: entry.scrim, fit: 'cover' }
    } else {
      panel.background = { follow: false, mode: 'solid', image: null, scrim: entry.scrim, fit: 'cover' }
    }
  }
  // The character theme library: sanitize every saved theme and drop a
  // dangling active id (its theme was removed or malformed).
  if (typeof r.themes === 'object' && r.themes !== null) {
    const th = r.themes as Record<string, unknown>
    const list: CharacterTheme[] = []
    if (Array.isArray(th.list)) {
      for (const item of th.list) {
        const theme = sanitizeTheme(item)
        if (theme !== null) list.push(theme)
      }
    }
    const active = typeof th.active === 'string' ? th.active : null
    base.themes = {
      active: active !== null && list.some(theme => theme.id === active) ? active : null,
      list,
    }
  }
  return base
}

/** Accepted asset file extensions (mirror of the host whitelist). */
export const ASSET_EXTENSIONS: readonly string[] = Object.freeze(['jpg', 'png', 'webp', 'gif'])

/** Parse an `asset:<sha256>.<ext>` image ref into its parts. */
export function parseAssetRef(image: string): { hash: string; ext: string } | null {
  const match = /^asset:([0-9a-f]{64})\.(jpg|png|webp|gif)$/.exec(image)
  if (match === null) return null
  const hash = match[1]
  const ext = match[2]
  if (hash === undefined || ext === undefined) return null
  return { hash, ext }
}

/** The host-served URL for an `asset:` ref, or null when it is not one. */
export function assetUrl(image: string): string | null {
  const ref = parseAssetRef(image)
  return ref === null ? null : `/personalization/assets/${ref.hash}.${ref.ext}`
}

/**
 * Resolve an image value to something the DOM can consume: `asset:` refs
 * become host-served URLs, everything else (data URLs, plain paths) passes
 * through unchanged.
 */
export function resolveImageSource(image: string | null): string | null {
  if (image === null) return null
  if (image.startsWith('asset:')) return assetUrl(image) ?? image
  return image
}

/** Whether an image value references a host-stored asset. */
export function isAssetRef(image: string | null | undefined): image is string {
  return typeof image === 'string' && image.startsWith('asset:')
}
