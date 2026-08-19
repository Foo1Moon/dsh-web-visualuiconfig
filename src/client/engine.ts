/**
 * Personalization effect engine: applies the configuration to the live page
 * and retracts everything it wrote on dispose.
 *
 * The engine follows the skin protocol proven by the deepseek-harness-skin
 * project:
 * - one body attribute (`data-dsh-personal`) activates attribute-scoped CSS
 *   injected through a single <style data-plugin-css> tag — every rule lives
 *   under that attribute, nothing touches global variables, and removing the
 *   attribute restores the official look;
 * - the palette comes from the OKLab contrast-preserving derivation
 *   (src/shared/derive.ts): four seed colours → the full `--dsw-static-*` ramp
 *   plus the brand roles, so a character theme lands on the same contrast
 *   structure as the official palette instead of on a color-mix guess. Both
 *   scheme blocks are emitted and the browser picks one via
 *   `[data-ds-dark-theme]`; a theme that pins its scheme also pins the body
 *   attribute, exactly like a skin pins its appearance;
 * - the page-wide backdrop rides a dedicated fixed layer element (negative
 *   z-index) instead of body inline styles — no `background-attachment: fixed`
 *   on body, no snapshot/restore of body styles;
 * - structural rules are gone: the old `[id=root]{background:0 0}` hack is
 *   replaced by a scoped `background: transparent` on the app root, emitted
 *   only while a page-wide backdrop is active;
 * - the scrim strength is a CSS variable, so moving a slider re-rasterizes
 *   live as the engine re-applies without any JS rewiring.
 *
 * Every write is retracted by the disposer (attribute, style tag, fixed layer,
 * scheme pin, favicon link, document title).
 *
 * The engine is DOM-only and framework-free; it depends on nothing but the
 * config object, so the settings page can drive it directly.
 */
import type { PanelConfig, PanelId, PersonalizationConfig } from './settings.ts'
import { PANEL_IDS, resolvePanelConfig } from './settings.ts'
import type { PaletteSeeds, BackgroundFit } from './settings.ts'
import { isAssetRef, parseAssetRef, resolveImageSource } from '../shared/config.ts'
import { deriveSkin, type SkinAppearance } from '../shared/derive.ts'
import { luminance, parseColor } from '../shared/color.ts'
import { PALETTE_PRESETS, type PalettePreset } from '../shared/presets.ts'
import { STOCK } from '../shared/stock.generated.ts'
import { PANEL_SCOPE_SELECTOR } from './panels.ts'
import { installStatusInjector } from './status-injector.ts'

/** Body attribute selecting the personalization CSS scope. */
const BODY_ATTRIBUTE = 'data-dsh-personal'

/** Scrim CSS variable consumed by the background gradient (0..1). */
const SCRIM_VARIABLE = '--dsh-personal-scrim'

/** The app's scheme attribute, pinned by a seeds theme that declares one. */
const SCHEME_ATTRIBUTE = 'data-ds-dark-theme'

// The preset catalog (builtin + skins + Catppuccin) lives in the shared half:
// the engine derives the ramp from its seeds, the settings page renders the
// swatch cards, and the host validates preset ids. Re-exported here so
// existing `from './engine.ts'` imports keep working.
export { PALETTE_PRESETS, type PalettePreset, type PresetGroup } from '../shared/presets.ts'

/** Build the accent-derived deepseek token group from a hex accent (the
 *  "quick accent" path — full derivation is preferred, see paletteBlocks). */
function accentGroup(accent: string): Record<string, string> {
  return {
    '--dsw-static-deepseek-50': `color-mix(in srgb, ${accent} 10%, white)`,
    '--dsw-static-deepseek-100': `color-mix(in srgb, ${accent} 18%, white)`,
    '--dsw-static-deepseek-200': `color-mix(in srgb, ${accent} 30%, white)`,
    '--dsw-static-deepseek-300': `color-mix(in srgb, ${accent} 45%, white)`,
    '--dsw-static-deepseek-400': `color-mix(in srgb, ${accent} 65%, white)`,
    '--dsw-static-deepseek-450': `color-mix(in srgb, ${accent} 80%, white)`,
    '--dsw-static-deepseek-500': accent,
    '--dsw-static-deepseek-600': `color-mix(in srgb, ${accent} 88%, black)`,
    '--dsw-static-deepseek-700-delete': `color-mix(in srgb, ${accent} 78%, black)`,
    '--dsw-static-deepseek-800': `color-mix(in srgb, ${accent} 68%, black)`,
    '--dsw-static-deepseek-900': `color-mix(in srgb, ${accent} 55%, black)`,
    '--dsw-static-blue-500': accent,
    '--dsw-alias-brand-primary': accent,
  }
}

/** The aionui-panel plugin's accent ramp for the light palette. */
function accentAionLight(accent: string): Record<string, string> {
  return {
    '--aion-primary': accent,
    '--aion-brand': `color-mix(in srgb, ${accent} 78%, white)`,
    '--aion-aou-1': `color-mix(in srgb, ${accent} 8%, white)`,
    '--aion-aou-2': `color-mix(in srgb, ${accent} 16%, white)`,
    '--aion-aou-3': `color-mix(in srgb, ${accent} 28%, white)`,
    '--aion-aou-4': `color-mix(in srgb, ${accent} 44%, white)`,
    '--aion-aou-5': `color-mix(in srgb, ${accent} 62%, white)`,
    '--aion-aou-6': accent,
  }
}

/** The aionui accent ramp for the dark palette (deep tint → light accent). */
function accentAionDark(accent: string): Record<string, string> {
  return {
    '--aion-primary': `color-mix(in srgb, ${accent} 72%, white)`,
    '--aion-brand': `color-mix(in srgb, ${accent} 68%, white)`,
    '--aion-aou-1': `color-mix(in srgb, ${accent} 82%, black)`,
    '--aion-aou-2': `color-mix(in srgb, ${accent} 72%, black)`,
    '--aion-aou-3': `color-mix(in srgb, ${accent} 60%, black)`,
    '--aion-aou-4': `color-mix(in srgb, ${accent} 48%, black)`,
    '--aion-aou-5': `color-mix(in srgb, ${accent} 30%, black)`,
    '--aion-aou-6': `color-mix(in srgb, ${accent} 60%, white)`,
  }
}

/** Typography presets: font-family stack for the UI and code fonts. */
export const FONT_PRESETS: readonly { id: string; label: string; ui: string; code: string }[] = Object.freeze([
  Object.freeze({ id: 'default', label: 'Default · 默认', ui: '', code: '' }),
  Object.freeze({
    id: 'rounded',
    label: 'Rounded · 圆润',
    ui: 'ui-rounded, "SF Pro Rounded", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    code: '"SF Mono", "JetBrains Mono", Consolas, "PingFang SC", "Microsoft YaHei", monospace',
  }),
  Object.freeze({
    id: 'serif',
    label: 'Serif · 衬线',
    ui: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
    code: '"Cascadia Code", Consolas, "Songti SC", monospace',
  }),
  Object.freeze({
    id: 'mono',
    label: 'Mono · 等宽',
    ui: '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", "PingFang SC", "Microsoft YaHei", monospace',
    code: '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", monospace',
  }),
])

/** The engine-owned style tag id (dedupe across re-applies). */
const STYLE_TAG_ID = 'dsh-web-visualuiconfig/personal.css'

/**
 * Attribute-scoped selectors for every injected rule. The `html` ancestor is
 * deliberate: it lifts specificity over the dsh-web-ui skins' equivalent
 * `body[data-dsh-<skin>]` rules (both are attribute selectors, but skins
 * inject later than this plugin in the boot order), so a personalization
 * toggle actually drives its tokens no matter which skin is active.
 */
const SCOPE = `html body[${BODY_ATTRIBUTE}]`

/**
 * Derivation cache: deriveSkin is pure and a little heavy (contrast
 * bisections per step), and the engine re-applies on every config change
 * (slider drags), so results are memoized by seeds + scheme.
 */
const deriveCache = new Map<string, { palette: Record<string, string>; brand: Record<string, string> }>()

/** Derive one scheme's palette + brand from seeds, memoized. */
function deriveTokens(seeds: PaletteSeeds, appearance: SkinAppearance): { palette: Record<string, string>; brand: Record<string, string> } {
  const key = `${appearance}|${seeds.accent}|${seeds.secondary}|${seeds.surface}|${seeds.text}`
  const hit = deriveCache.get(key)
  if (hit !== undefined) return hit
  const derived = deriveSkin({ id: 'personal', appearance, chrome: 'glass', seeds }, STOCK)
  const value = { palette: derived.palette, brand: derived.brand }
  deriveCache.set(key, value)
  return value
}

/** One palette resolution: light/dark token blocks plus an optional scheme pin. */
interface PaletteBlocks {
  /** Token overrides for the light scheme (empty when pinned dark). */
  light: Record<string, string>
  /** Token overrides for the dark scheme (empty when pinned light). */
  dark: Record<string, string>
  /** The scheme the palette pins the UI to, or null (both blocks emitted). */
  pin: SkinAppearance | null
}

/** Resolve a palette choice to token blocks (seeds → derivation, preset →
 *  per-scheme seeds derivation, accent → color-mix fallback). */
function paletteBlocks(palette: PanelConfig['palette']): PaletteBlocks {
  if (palette.seeds !== null) {
    if (palette.appearance !== null) {
      const { palette: tokens, brand } = deriveTokens(palette.seeds, palette.appearance)
      const merged = { ...brand, ...tokens }
      return palette.appearance === 'dark'
        ? { light: {}, dark: merged, pin: 'dark' }
        : { light: merged, dark: {}, pin: 'light' }
    }
    const light = deriveTokens(palette.seeds, 'light')
    const dark = deriveTokens(palette.seeds, 'dark')
    return {
      light: { ...light.brand, ...light.palette },
      dark: { ...dark.brand, ...dark.palette },
      pin: null,
    }
  }
  if (palette.preset !== '') {
    const preset = PALETTE_PRESETS.find(p => p.id === palette.preset)
    if (preset !== undefined) {
      const light = deriveTokens(preset.light, 'light')
      const dark = deriveTokens(preset.dark, 'dark')
      return {
        light: { ...light.brand, ...light.palette },
        dark: { ...dark.brand, ...dark.palette },
        pin: null,
      }
    }
  }
  if (palette.accent !== null) {
    const group = accentGroup(palette.accent)
    return { light: group, dark: group, pin: null }
  }
  return { light: {}, dark: {}, pin: null }
}

/** Base RGB triplets the translucent surfaces derive from (the official alias
 *  token values for each palette). The user's transparency strength is folded
 *  into each token's alpha at apply time. */
const GLASS_BASE_LIGHT: Record<string, string> = Object.freeze({
  '--dsw-alias-bg-base': '255, 255, 255',
  '--dsw-alias-bg-layer-1': '243, 245, 251',
  '--dsw-alias-bg-layer-2': '233, 237, 247',
  '--dsw-alias-bg-layer-3': '221, 227, 241',
  '--dsw-alias-bg-overlay': '238, 241, 249',
  '--dsw-specific-sidebar-fill': '242, 245, 250',
  '--dsw-specific-input-major': '255, 255, 255',
  '--dsw-specific-menu': '243, 245, 251',
})

/** Base RGB triplets for the dark base palette. */
const GLASS_BASE_DARK: Record<string, string> = Object.freeze({
  '--dsw-alias-bg-base': '16, 22, 42',
  '--dsw-alias-bg-layer-1': '26, 34, 56',
  '--dsw-alias-bg-layer-2': '32, 40, 68',
  '--dsw-alias-bg-layer-3': '38, 44, 79',
  '--dsw-alias-bg-overlay': '26, 34, 56',
  '--dsw-specific-sidebar-fill': '29, 37, 57',
  '--dsw-specific-input-major': '26, 34, 56',
  '--dsw-specific-menu': '26, 34, 56',
})

/** Base RGB triplets for the aionui-panel plugin's surfaces (light palette). */
const AION_BASE_LIGHT: Record<string, string> = Object.freeze({
  '--aion-bg-base': '255, 255, 255',
  '--aion-bg-1': '249, 250, 251',
  '--aion-bg-2': '242, 243, 245',
  '--aion-bg-3': '229, 230, 235',
  '--aion-bg-hover': '243, 244, 246',
  '--aion-bg-active': '229, 230, 235',
  '--aion-border-base': '229, 230, 235',
})

/** Base RGB triplets for the aionui panel surfaces, dark palette. */
const AION_BASE_DARK: Record<string, string> = Object.freeze({
  '--aion-bg-base': '14, 14, 14',
  '--aion-bg-1': '26, 26, 26',
  '--aion-bg-2': '38, 38, 38',
  '--aion-bg-3': '51, 51, 51',
  '--aion-bg-hover': '31, 31, 31',
  '--aion-bg-active': '45, 45, 45',
  '--aion-border-base': '51, 51, 51',
})

/** "#rrggbb" → "r, g, b" (the RGB-triplet form the alias tokens take). */
function rgbTriplet(hex: string): string {
  const [r, g, b] = parseColor(hex)
  return `${r}, ${g}, ${b}`
}

/** Mix two RGB triplets in sRGB: `weight` of `a`, (1 - weight) of `b`. */
function mixTriplets(a: string, b: string, weight: number): string {
  const pa = a.split(',').map(s => Number(s.trim()))
  const pb = b.split(',').map(s => Number(s.trim()))
  const c = pa.map((v, i) => Math.round(v * weight + (pb[i] ?? 0) * (1 - weight)))
  return c.join(', ')
}

/**
 * The translucent alias base derived from a theme surface, or the official
 * base when no surface is in effect (accent-only / default look). The layers
 * step away from the surface in the same direction the official ramp does —
 * darker in light mode, lighter in dark mode — so the panel tint follows the
 * theme instead of the hardcoded official white/navy.
 */
function glassBase(surface: string | null, dark: boolean): Record<string, string> {
  const official = dark ? GLASS_BASE_DARK : GLASS_BASE_LIGHT
  if (surface === null) return official
  const base = rgbTriplet(surface)
  const step = (weight: number): string =>
    dark ? mixTriplets(base, '255, 255, 255', weight) : mixTriplets(base, '0, 0, 0', weight)
  return {
    '--dsw-alias-bg-base': base,
    '--dsw-alias-bg-layer-1': step(0.94),
    '--dsw-alias-bg-layer-2': step(0.88),
    '--dsw-alias-bg-layer-3': step(0.82),
    '--dsw-alias-bg-overlay': step(0.92),
    '--dsw-specific-sidebar-fill': step(0.94),
    '--dsw-specific-input-major': dark ? step(0.72) : '255, 255, 255',
    '--dsw-specific-menu': step(0.93),
  }
}

/** Same derivation for the aionui panel's own surface tokens. */
function aionGlassBase(surface: string | null, dark: boolean): Record<string, string> {
  const official = dark ? AION_BASE_DARK : AION_BASE_LIGHT
  if (surface === null) return official
  const base = rgbTriplet(surface)
  const step = (weight: number): string =>
    dark ? mixTriplets(base, '255, 255, 255', weight) : mixTriplets(base, '0, 0, 0', weight)
  return {
    '--aion-bg-base': base,
    '--aion-bg-1': step(0.95),
    '--aion-bg-2': step(0.90),
    '--aion-bg-3': step(0.85),
    '--aion-bg-hover': step(0.92),
    '--aion-bg-active': step(0.88),
    '--aion-border-base': step(0.88),
  }
}

/** Per-surface alpha reduction factor: how much of the user's transparency
 *  strength each surface takes. Floating layers (overlay/menu/input/dialog)
 *  stay more opaque than the page layers so they remain readable. */
const GLASS_FACTORS: Record<string, number> = Object.freeze({
  '--dsw-alias-bg-base': 1.0,
  '--dsw-alias-bg-layer-1': 0.97,
  '--dsw-alias-bg-layer-2': 0.94,
  '--dsw-alias-bg-layer-3': 0.9,
  '--dsw-alias-bg-overlay': 0.55,
  '--dsw-specific-sidebar-fill': 0.92,
  '--dsw-specific-input-major': 0.75,
  '--dsw-specific-menu': 0.6,
  '--aion-bg-base': 0.55,
  '--aion-bg-1': 0.97,
  '--aion-bg-2': 0.94,
  '--aion-bg-3': 0.9,
  '--aion-bg-hover': 0.9,
  '--aion-bg-active': 0.85,
  '--aion-border-base': 0.85,
})

/** Derive translucent token values from a base palette and a strength. */
function glassTokens(base: Record<string, string>, opacity: number): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [name, rgb] of Object.entries(base)) {
    // alpha = 1 at strength 0 (official opaque); a floor keeps text legible.
    const alpha = Math.min(1, Math.max(0.06, 1 - opacity * (GLASS_FACTORS[name] ?? 1)))
    tokens[name] = `rgba(${rgb}, ${alpha.toFixed(3)})`
  }
  return tokens
}

/** One scheme's scrollbar colours (thumb/hover tokens + track/corner). */
interface ScrollbarColors {
  '--dsh-scrollbar-thumb': string
  '--dsh-scrollbar-thumb-hover': string
  track: string
  corner: string
}

/** Default scrollbar palette (light). */
const SCROLLBAR_LIGHT: ScrollbarColors = Object.freeze({
  '--dsh-scrollbar-thumb': '#b4c3e8',
  '--dsh-scrollbar-thumb-hover': '#7f96d2',
  track: '#eef1f9',
  corner: '#eef1f9',
})

/** Default scrollbar palette (dark). */
const SCROLLBAR_DARK: ScrollbarColors = Object.freeze({
  '--dsh-scrollbar-thumb': '#455678',
  '--dsh-scrollbar-thumb-hover': '#6276a5',
  track: '#141a2b',
  corner: '#141a2b',
})

/** The panel's effective accent color, or null when none is configured. */
function paletteAccent(palette: PanelConfig['palette']): string | null {
  return palette.accent ?? palette.seeds?.accent
    ?? PALETTE_PRESETS.find(p => p.id === palette.preset)?.accent ?? null
}

/**
 * Scrollbar palette for one scheme: the thumb takes the theme accent (so the
 * bar follows the palette instead of the hardcoded neutral blue), hover
 * darkens in light mode / lightens in dark mode, and the track stays
 * transparent like the upstream skin so the thumb reads against the themed
 * surface. Falls back to the neutral default when no accent is in effect.
 */
function scrollbarPalette(accent: string | null, dark: boolean): ScrollbarColors {
  if (accent === null) return dark ? SCROLLBAR_DARK : SCROLLBAR_LIGHT
  return dark
    ? {
      '--dsh-scrollbar-thumb': `color-mix(in srgb, ${accent} 82%, #ffffff)`,
      '--dsh-scrollbar-thumb-hover': `color-mix(in srgb, ${accent} 92%, #ffffff)`,
      track: 'transparent',
      corner: 'transparent',
    }
    : {
      '--dsh-scrollbar-thumb': accent,
      '--dsh-scrollbar-thumb-hover': `color-mix(in srgb, ${accent} 74%, #000000)`,
      track: 'transparent',
      corner: 'transparent',
    }
}

/** Build the palette override block for one color scheme. */
function paletteRule(selector: string, tokens: Record<string, string>): string {
  const body = Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';')
  return `${selector}{${body}}`
}

/** Serialize a token map as declarations. */
function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';')
}

/**
 * Cache of stored image string → blob URL. Backgrounds render through short
 * `blob:` URLs instead of inlining the base64 into the stylesheet: Chromium's
 * CSS parser rejects `url()` values longer than 2 MB (kMaxURLChars) and
 * silently drops the whole declaration. blob: URLs are short, so they are
 * exempt; each unique image is decoded once and reused for the module's
 * lifetime.
 */
const blobUrlCache = new Map<string, string>()

/** Convert a data URI to a cached blob URL. Falls back to the raw data URI
 *  in non-browser environments (jsdom diagnostics lack createObjectURL).
 *  `asset:` refs bypass this entirely — they render as short same-origin
 *  URLs, which the 2 MB CSS `url()` limit does not apply to. */
function resolveBackgroundUrl(image: string): string {
  if (image.startsWith('asset:')) {
    return resolveImageSource(image) ?? image
  }
  const cached = blobUrlCache.get(image)
  if (cached !== undefined) return cached
  let url = image
  try {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      image.startsWith('data:')
    ) {
      const comma = image.indexOf(',')
      if (comma !== -1) {
        const mime = /^data:([^;,]+)/.exec(image)?.[1] ?? 'image/jpeg'
        const binary = atob(image.slice(comma + 1))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      }
    }
  } catch {
    url = image
  }
  blobUrlCache.set(image, url)
  return url
}

/** Build the scrim-gradient background image for a stored image. The scrim
 *  alpha is a CSS variable reference so moving a slider re-rasterizes live
 *  without rewriting the stylesheet. The variable always carries a `0`
 *  fallback: a missing variable would otherwise invalidate the whole
 *  declaration at computed-value time and background-image would fall back to
 *  `none`, silently killing the image layer too. */
function backdropImage(image: string, scrim?: string): string {
  const alpha = scrim === undefined ? `var(${SCRIM_VARIABLE}, 0)` : `var(${scrim}, 0)`
  return `linear-gradient(rgba(10, 14, 28, ${alpha}) 0%, rgba(10, 14, 28, ${alpha}) 100%), url(${resolveBackgroundUrl(image)})`
}

/** Background-size (per layer) for each fit mode. The backdrop is two layers
 *  (scrim gradient over the picture): the gradient always covers, the picture
 *  follows the fit. */
const FIT_SIZE: Record<BackgroundFit, string> = {
  cover: 'cover',
  contain: 'contain',
  stretch: '100% 100%',
  tile: 'auto',
}

/** Background-repeat (per layer) for each fit mode. */
const FIT_REPEAT: Record<BackgroundFit, string> = {
  cover: 'no-repeat',
  contain: 'no-repeat',
  stretch: 'no-repeat',
  tile: 'repeat',
}

/** Two-layer background-size/repeat declarations for one fit mode. */
function backdropFit(fit: BackgroundFit): string {
  return `background-size:cover, ${FIT_SIZE[fit]};background-repeat:no-repeat, ${FIT_REPEAT[fit]}`
}

/** Light/dark selectors scoping one panel's overrides to its own subtree. */
function scopeSelectors(id: PanelId): { light: string; dark: string } {
  const raw = PANEL_SCOPE_SELECTOR[id]
  const selectors = raw === ''
    ? []
    : raw.split(',').map(s => s.trim()).filter(s => s !== '')
  const light = selectors.length === 0
    ? SCOPE
    : selectors.map(sel => `${SCOPE} ${sel}`).join(', ')
  const dark = selectors.length === 0
    ? `${SCOPE}[${SCHEME_ATTRIBUTE}]`
    : selectors.map(sel => `${SCOPE}[${SCHEME_ATTRIBUTE}] ${sel}`).join(', ')
  return { light, dark }
}

/**
 * Apply a CSS suffix (pseudo-element, descendant) to EVERY selector in a
 * comma-separated scope list. Naively joining `scope + '::x'` applies the
 * pseudo only to the LAST selector while the earlier bare selectors receive
 * the whole declaration block — which is exactly how a 10px scrollbar width
 * once ended up sizing the sidebar element itself and collapsed the whole
 * frame to a 14px blob ("all UI squished together").
 */
function suffixed(scope: { light: string; dark: string }, suffix: string): { light: string; dark: string } {
  const map = (list: string): string =>
    list.split(',').map(sel => `${sel.trim()}${suffix}`).join(', ')
  return { light: map(scope.light), dark: map(scope.dark) }
}

/**
 * Own + descendant pseudo-element selectors for every selector in the scope
 * list (used for both `::-webkit-scrollbar*` and `::selection`). The panel
 * element's OWN pseudo alone misses what actually renders inside a panel:
 * third-party views mounted inside a column (task board, SSH, …) scroll their
 * inner subtree, and text selection happens on deep child elements — so the
 * panel's own pseudo alone falls back to the global skin (the official blue
 * scrollbar, the default selection tint) instead of the theme.
 */
function scrollbarSelectors(scope: { light: string; dark: string }, suffix: string): { light: string; dark: string } {
  const own = suffixed(scope, suffix)
  const desc = suffixed(scope, ` ${suffix}`)
  return { light: `${own.light}, ${desc.light}`, dark: `${own.dark}, ${desc.dark}` }
}

/** Resolve a palette choice to its --aion-* accent tables (aionui panel). */
function aionPalette(palette: PanelConfig['palette']): { light: Record<string, string>; dark: Record<string, string> } | null {
  const accent = paletteAccent(palette)
  if (accent === null) return null
  return { light: accentAionLight(accent), dark: accentAionDark(accent) }
}

/** Resolve the font stacks for one panel config. */
function fontStacks(font: PanelConfig['font']): { ui: string; code: string } {
  const preset = FONT_PRESETS.find(f => f.id === font.family)
  const ui = font.custom.trim() !== '' ? font.custom : (preset?.ui ?? '')
  return { ui, code: preset?.code ?? '' }
}

/**
 * A --dsw-* consuming surface's rule set (the official columns, and any
 * third-party view that reuses the official tokens): token overrides scoped
 * to the panel's own subtree via the caller-provided selectors.
 */
function dswCss(scope: { light: string; dark: string }, pc: PanelConfig): string[] {
  const parts: string[] = []
  const { light, dark } = scope
  if (pc.glass.opacity > 0) {
    // The alias surfaces derive from the theme's surface seed so the panel
    // tint follows the theme (glassBase falls back to the official base).
    const surface = pc.palette.seeds?.surface ?? null
    parts.push(paletteRule(light, glassTokens(glassBase(surface, false), pc.glass.opacity)))
    parts.push(paletteRule(dark, glassTokens(glassBase(surface, true), pc.glass.opacity)))
    // No backdrop-filter here, deliberately: applying it to the frame columns
    // makes them the containing block for fixed-position descendants (the
    // settings modal, popovers), trapping those overlays inside the column —
    // the same boundary the skin systems document. Translucent token
    // backgrounds alone let the backdrop show through the layered surfaces.
  }
  const blocks = paletteBlocks(pc.palette)
  if (Object.keys(blocks.light).length > 0) parts.push(paletteRule(light, blocks.light))
  if (Object.keys(blocks.dark).length > 0) parts.push(paletteRule(dark, blocks.dark))
  const { ui, code } = fontStacks(pc.font)
  if (ui !== '') parts.push(`${light}{--dsw-font-family:${ui}}`)
  if (code !== '') parts.push(`${light}{--ds-font-family-code:${code}}`)
  if (pc.scrollbar) {
    // The thumb follows the panel's accent (theme) instead of the hardcoded
    // neutral blue — see scrollbarPalette.
    const accent = paletteAccent(pc.palette)
    const lightColors = scrollbarPalette(accent, false)
    const darkColors = scrollbarPalette(accent, true)
    // Every pseudo-element suffix is applied to each selector in the scope
    // list individually — a bare selector in the list would otherwise receive
    // the declaration block itself (see suffixed). Both the panel's own
    // pseudo and its descendants' are targeted (see scrollbarSelectors).
    const scroll = scrollbarSelectors(scope, '::-webkit-scrollbar')
    const track = scrollbarSelectors(scope, '::-webkit-scrollbar-track')
    const thumb = scrollbarSelectors(scope, '::-webkit-scrollbar-thumb')
    const thumbHover = scrollbarSelectors(scope, '::-webkit-scrollbar-thumb:hover')
    const corner = scrollbarSelectors(scope, '::-webkit-scrollbar-corner')
    parts.push(
      `${light}{${declarations({ '--dsh-scrollbar-thumb': lightColors['--dsh-scrollbar-thumb'], '--dsh-scrollbar-thumb-hover': lightColors['--dsh-scrollbar-thumb-hover'] })}}`,
      `${scroll.light}{width:10px;height:10px;--dsh-scrollbar-width:10px}`,
      `${track.light}{background:${lightColors.track}}`,
      `${thumb.light}{background:${lightColors['--dsh-scrollbar-thumb']};border:2px solid ${lightColors.track};border-radius:5px}`,
      `${thumbHover.light}{background:${lightColors['--dsh-scrollbar-thumb-hover']}}`,
      `${corner.light}{background:${lightColors.corner}}`,
      `${dark}{${declarations({ '--dsh-scrollbar-thumb': darkColors['--dsh-scrollbar-thumb'], '--dsh-scrollbar-thumb-hover': darkColors['--dsh-scrollbar-thumb-hover'] })}}`,
      `${track.dark},${corner.dark}{background:${darkColors.track}}`,
      `${thumb.dark}{background:${darkColors['--dsh-scrollbar-thumb']};border-color:${darkColors.track}}`,
      `${thumbHover.dark}{background:${darkColors['--dsh-scrollbar-thumb-hover']}}`,
    )
  }
  if (pc.selection !== null) {
    // Own + descendant so text selected on any child element takes the theme
    // tint; the text color flips by the selection's luminance (white text on a
    // light selection is unreadable).
    const fg = luminance(pc.selection) > 0.5 ? '#202020' : '#ffffff'
    parts.push(`${scrollbarSelectors(scope, '::selection').light}{color:${fg};background:${pc.selection}}`)
  }
  return parts
}

/** The aionui right panel's rule set (its own --aion-* token group). */
function aionuiCss(scope: { light: string; dark: string }, pc: PanelConfig): string[] {
  const parts: string[] = []
  const { light, dark } = scope
  if (pc.glass.opacity > 0) {
    const surface = pc.palette.seeds?.surface ?? null
    parts.push(paletteRule(light, glassTokens(aionGlassBase(surface, false), pc.glass.opacity)))
    parts.push(paletteRule(dark, glassTokens(aionGlassBase(surface, true), pc.glass.opacity)))
  }
  const palette = aionPalette(pc.palette)
  if (palette !== null) {
    parts.push(paletteRule(light, palette.light), paletteRule(dark, palette.dark))
  }
  const { ui, code } = fontStacks(pc.font)
  if (ui !== '') parts.push(`${light}{--aion-font-sans:${ui}}`)
  if (code !== '') parts.push(`${light}{--aion-font-mono:${code}}`)
  if (pc.scrollbar) {
    // The thumb follows the panel's accent (theme) instead of the hardcoded
    // neutral blue — see scrollbarPalette.
    const accent = paletteAccent(pc.palette)
    const lightColors = scrollbarPalette(accent, false)
    const darkColors = scrollbarPalette(accent, true)
    // Own + descendant pseudos (see scrollbarSelectors): the aionui columns
    // scroll their inner subtree, but the columns themselves may scroll too.
    const scroll = scrollbarSelectors(scope, '::-webkit-scrollbar')
    const thumb = scrollbarSelectors(scope, '::-webkit-scrollbar-thumb')
    const thumbHover = scrollbarSelectors(scope, '::-webkit-scrollbar-thumb:hover')
    const track = scrollbarSelectors(scope, '::-webkit-scrollbar-track')
    parts.push(
      `${scroll.light}{width:8px;height:8px;--dsh-scrollbar-width:8px}`,
      `${thumb.light}{background:${lightColors['--dsh-scrollbar-thumb']};border-radius:4px}`,
      `${thumbHover.light}{background:${lightColors['--dsh-scrollbar-thumb-hover']}}`,
      `${track.light}{background:transparent}`,
      `${thumb.dark}{background:${darkColors['--dsh-scrollbar-thumb']}}`,
      `${thumbHover.dark}{background:${darkColors['--dsh-scrollbar-thumb-hover']}}`,
    )
  }
  if (pc.selection !== null) {
    // Same own + descendant treatment and luminance-aware text as dswCss.
    const fg = luminance(pc.selection) > 0.5 ? '#202020' : '#ffffff'
    parts.push(`${scrollbarSelectors(scope, '::selection').light}{color:${fg};background:${pc.selection}}`)
  }
  return parts
}

/** One panel's rule set from its own appearance config and token group. */
function panelCss(id: PanelId, pc: PanelConfig): string[] {
  const scope = scopeSelectors(id)
  return id === 'aionui' ? aionuiCss(scope, pc) : dswCss(scope, pc)
}

/** Per-panel scrim variable name (alpha rides a CSS variable, so the slider
 *  re-rasterizes live without rewriting the injected stylesheet). */
function scrimVariable(id: PanelId): string {
  return `${SCRIM_VARIABLE}-${id}`
}

// ── diagnostics ─────────────────────────────────────────────────────────────

/** Throttle between diagnostics reports (slider drags re-apply constantly). */
const DIAGNOSTICS_THROTTLE_MS = 2000
let lastDiagnosticsAt = 0

/** Measure the live layout around the surfaces a collapse would show in. */
function measureLayout(): Record<string, unknown> {
  const rect = (el: Element | null): Record<string, unknown> | null => {
    if (el === null) return null
    const b = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      display: cs.display, bg: cs.backgroundColor, opacity: cs.opacity,
    }
  }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    textarea: rect(document.querySelector('textarea')),
    conversation: rect(document.querySelector('[data-pane="conversation"]')),
    sidebar: rect(document.querySelector('[data-pane="sidebar"]')),
    schemeAttr: document.body.hasAttribute(SCHEME_ATTRIBUTE),
    bodyInlineTokenBytes: document.body.getAttribute('style')?.length ?? 0,
  }
}

/** The applied config with bulky image payloads stripped (kept small for the log). */
function stripConfig(config: PersonalizationConfig): Record<string, unknown> {
  const clone = structuredClone(config) as PersonalizationConfig
  const strip = (value: string | null): string | null =>
    value !== null && value.startsWith('data:') ? '<data-url>' : value
  clone.globalBackground.image = strip(clone.globalBackground.image)
  clone.chrome.favicon = strip(clone.chrome.favicon)
  clone.base.background.image = strip(clone.base.background.image)
  for (const id of PANEL_IDS) clone.panels[id].background.image = strip(clone.panels[id].background.image)
  clone.themes = {
    active: clone.themes.active,
    list: clone.themes.list.map(theme => ({ ...theme, sourceImage: strip(theme.sourceImage) })),
  }
  return clone as unknown as Record<string, unknown>
}

/**
 * Fire-and-forget, throttled report of one applied config: the appearance
 * knobs, the emitted CSS, and live layout measurements, POSTed to the host
 * diagnostics log (`~/.dsh/personalization-diagnostics.jsonl`) so a
 * reproduced layout collapse can be diagnosed from the file.
 */
function reportDiagnostics(config: PersonalizationConfig, css: string, pin: SkinAppearance | null): void {
  const now = Date.now()
  if (now - lastDiagnosticsAt < DIAGNOSTICS_THROTTLE_MS) return
  lastDiagnosticsAt = now
  try {
    void fetch('/personalization/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        t: now,
        pin,
        config: stripConfig(config),
        css: css.slice(0, 30000),
        layout: measureLayout(),
      }),
    }).catch(() => { /* host unreachable is fine — diagnostics are best-effort */ })
  } catch {
    // Non-browser environment (tests): no fetch, or a relative URL that cannot
    // resolve — diagnostics are best-effort and never break the apply.
  }
}

/**
 * Apply the personalization configuration to the document.
 * @param config - the configuration to project.
 * @returns a disposer retracting every write (attribute, style tag, backdrop
 * layer, scheme pin, favicon link, document title).
 */
export function applyPersonalization(config: PersonalizationConfig): () => void {
  const body = document.body
  const previousScheme = body.hasAttribute(SCHEME_ATTRIBUTE)
  const previousTitle = document.title
  const previousFavicon = document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')

  // Body attribute activates the injected scope CSS.
  body.setAttribute(BODY_ATTRIBUTE, '')

  // The page-wide backdrop rides a dedicated fixed layer (bottom-most, behind
  // the app root) with its scrim as a CSS variable on that element — no body
  // inline styles, no background-attachment on body.
  const globalBg = config.globalBackground.image
  const hasGlobalBg = globalBg !== null && globalBg !== undefined
  let backdropLayer: HTMLDivElement | null = null
  if (hasGlobalBg) {
    backdropLayer = document.createElement('div')
    backdropLayer.dataset.dshPersonalBackdrop = ''
    backdropLayer.style.cssText = 'position:fixed;inset:0;z-index:-1;background-position:center'
    backdropLayer.style.setProperty('background-image', backdropImage(globalBg))
    backdropLayer.style.setProperty('background-size', `cover, ${FIT_SIZE[config.globalBackground.fit]}`)
    backdropLayer.style.setProperty('background-repeat', `no-repeat, ${FIT_REPEAT[config.globalBackground.fit]}`)
    backdropLayer.style.setProperty(SCRIM_VARIABLE, String(config.globalBackground.scrim))
    if (config.globalBackground.blur > 0) {
      // The blur lives on the standalone fixed backdrop element (z-index:-1),
      // never on a column — so it creates no containing block for the fixed
      // overlays (settings modal, popovers). Verified against dsh-skin, which
      // does exactly this.
      backdropLayer.style.filter = `blur(${config.globalBackground.blur}px)`
    }
    document.body.appendChild(backdropLayer)
  }

  // Composite the injected stylesheet: page-wide palette + backdrop rules,
  // then one rule set per panel driven by its resolved appearance.
  const cssParts: string[] = []

  // The "all panels" baseline palette drives the whole page (attribute scope);
  // panels that break away override within their own subtree.
  const baseBlocks = paletteBlocks(config.base.palette)
  if (Object.keys(baseBlocks.light).length > 0) {
    cssParts.push(paletteRule(SCOPE, baseBlocks.light))
  }
  if (Object.keys(baseBlocks.dark).length > 0) {
    cssParts.push(paletteRule(`${SCOPE}[${SCHEME_ATTRIBUTE}]`, baseBlocks.dark))
  }
  // A seeds theme that pins its scheme also pins the app's scheme attribute
  // (the same way a skin pins its appearance), so the alias layer matches the
  // derived ramp.
  if (baseBlocks.pin !== null) {
    body.toggleAttribute(SCHEME_ATTRIBUTE, baseBlocks.pin === 'dark')
  }

  if (hasGlobalBg) {
    // The app root may paint an opaque background that would hide the fixed
    // layer; this scoped, background-only rule is emitted only while a
    // page-wide backdrop is active.
    cssParts.push(`${SCOPE} [id=root]{background:transparent}`)
    // A translucent base layer lets the page-wide backdrop show through the
    // frame under every column; each panel's own transparency and backdrop
    // decide how much of it reaches the surface.
    const surface = config.base.palette.seeds?.surface ?? null
    cssParts.push(paletteRule(SCOPE, glassTokens(glassBase(surface, false), 0.5)))
    cssParts.push(paletteRule(`${SCOPE}[${SCHEME_ATTRIBUTE}]`, glassTokens(glassBase(surface, true), 0.5)))
  }

  for (const id of PANEL_IDS) {
    // Follow knobs inherit the "all panels" baseline; the engine styles the
    // resolved appearance.
    const pc = resolvePanelConfig(config.base, config.panels[id])
    const rules = panelCss(id, pc)
    // The backdrop image, when the background mode is 'image', renders at the
    // panel's layer; the panel's transparency slider controls how much of it
    // shows through the panel surfaces. The scrim variable lives in the same
    // attribute-scoped rule (not on body).
    if (pc.background.mode === 'image' && pc.background.image !== null && pc.background.image !== undefined) {
      const scope = scopeSelectors(id)
      rules.unshift(
        `${scope.light}{${scrimVariable(id)}:${pc.background.scrim};background-image:${backdropImage(pc.background.image, scrimVariable(id))};background-position:center;${backdropFit(pc.background.fit)}}`,
      )
    }
    cssParts.push(...rules)
  }

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-web-visualuiconfig'
  style.dataset.pluginCss = STYLE_TAG_ID
  style.textContent = cssParts.join('')
  document.head.appendChild(style)

  // Diagnostics: report the applied knobs + CSS + layout to the host log
  // (throttled), so a reproduced layout bug is diagnosable without a browser.
  reportDiagnostics(config, style.textContent, baseBlocks.pin)

  // Favicon and title.
  let favicon: HTMLLinkElement | undefined
  if (config.chrome.favicon !== null) {
    favicon = document.createElement('link')
    favicon.rel = 'icon'
    // Host assets carry their own format; data URLs are png (the compressor).
    const ref = isAssetRef(config.chrome.favicon) ? parseAssetRef(config.chrome.favicon) : null
    const mime = ref === null
      ? 'image/png'
      : ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[ref.ext] ?? 'image/png'
    favicon.type = mime
    favicon.href = resolveImageSource(config.chrome.favicon) ?? config.chrome.favicon
    document.head.append(favicon)
  }
  if (config.chrome.title !== null) {
    document.title = config.chrome.title
  }

  // Running-turn status text: replaces the official "Deep diving..." label
  // via a DOM observer (upstream hard-codes it with no seam); '' keeps the
  // official label and installs nothing.
  const statusText = (config.chrome.statusText ?? '').trim()
  const statusInjector = statusText === ''
    ? null
    : installStatusInjector(statusText)

  return () => {
    body.removeAttribute(BODY_ATTRIBUTE)
    if (previousScheme) body.setAttribute(SCHEME_ATTRIBUTE, '')
    else body.removeAttribute(SCHEME_ATTRIBUTE)
    backdropLayer?.remove()
    style.remove()
    if (favicon !== undefined) favicon.remove()
    if (document.title !== previousTitle) document.title = previousTitle
    statusInjector?.()
  }
}
