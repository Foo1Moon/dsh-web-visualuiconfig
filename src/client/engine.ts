/**
 * Personalization effect engine: applies the configuration to the live page
 * and retracts everything it wrote on dispose.
 *
 * The engine follows the skin protocol proven by the dsh-web-ui skins:
 * - one body attribute (`data-dsh-personal`) activates attribute-scoped CSS
 *   injected through a single <style data-plugin-css> tag;
 * - the background image rides body inline styles (previous values are
 *   snapshotted and restored verbatim on dispose);
 * - the scrim strength is a CSS variable (`--dsh-personal-scrim`) whose alpha
 *   the browser re-rasterizes live as the settings slider moves — no JS
 *   rewiring needed;
 * - every write is retracted by the disposer (attribute, inline styles,
 *   style tag, favicon link, document title).
 *
 * The engine is DOM-only and framework-free; it depends on nothing but the
 * config object, so the settings page can drive it directly.
 */
import type { PanelConfig, PanelId, PersonalizationConfig } from './settings.ts'
import { PANEL_IDS, resolvePanelConfig } from './settings.ts'
import { isAssetRef, parseAssetRef, resolveImageSource } from '../shared/config.ts'
import { PANEL_SCOPE_SELECTOR } from './panels.ts'

/** Body attribute selecting the personalization CSS scope. */
const BODY_ATTRIBUTE = 'data-dsh-personal'

/** Scrim CSS variable consumed by the background gradient (0..1). */
const SCRIM_VARIABLE = '--dsh-personal-scrim'

/** Background shorthand properties this engine writes on body. */
const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/** One palette preset: static token overrides for both color schemes. */
export interface PalettePreset {
  /** Preset id ('' is the built-in look). */
  id: string
  /** Display label (the caller supplies the locale). */
  label: string
  /** The accent this preset is built around (drives the aionui ramp). */
  accent: string
  /** Token → value for the light base palette. */
  light: Record<string, string>
  /** Token → value for the dark base palette. */
  dark: Record<string, string>
}

/** Build the accent-derived deepseek token group from a hex accent. */
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

/**
 * The aionui-panel plugin's accent ramp, derived from the chosen accent for
 * the light palette. aou-1 is the lightest surface tint, aou-6 the strongest
 * accent (mirrors the plugin's own light ramp).
 */
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

/** Built-in palette presets (static token tables, light + dark). */
export const PALETTE_PRESETS: readonly PalettePreset[] = Object.freeze([
  Object.freeze({
    id: 'ocean',
    label: 'Ocean · 海洋青',
    accent: 'rgb(26, 138, 146)',
    light: {
      '--dsw-static-deepseek-50': 'rgb(229, 246, 246)',
      '--dsw-static-deepseek-100': 'rgb(205, 239, 239)',
      '--dsw-static-deepseek-200': 'rgb(172, 227, 228)',
      '--dsw-static-deepseek-300': 'rgb(128, 207, 210)',
      '--dsw-static-deepseek-400': 'rgb(79, 179, 184)',
      '--dsw-static-deepseek-450': 'rgb(52, 155, 161)',
      '--dsw-static-deepseek-500': 'rgb(26, 138, 146)',
      '--dsw-static-deepseek-600': 'rgb(22, 113, 121)',
      '--dsw-static-deepseek-700-delete': 'rgb(24, 92, 100)',
      '--dsw-static-deepseek-800': 'rgb(26, 74, 80)',
      '--dsw-static-deepseek-900': 'rgb(22, 56, 61)',
      '--dsw-static-blue-500': 'rgb(26, 138, 146)',
      '--dsw-alias-brand-primary': 'rgb(26, 138, 146)',
    },
    dark: {
      '--dsw-static-deepseek-50': 'rgb(20, 46, 50)',
      '--dsw-static-deepseek-100': 'rgb(23, 56, 61)',
      '--dsw-static-deepseek-200': 'rgb(27, 72, 78)',
      '--dsw-static-deepseek-300': 'rgb(33, 95, 103)',
      '--dsw-static-deepseek-400': 'rgb(40, 124, 134)',
      '--dsw-static-deepseek-450': 'rgb(52, 155, 161)',
      '--dsw-static-deepseek-500': 'rgb(26, 138, 146)',
      '--dsw-static-deepseek-600': 'rgb(96, 190, 195)',
      '--dsw-static-deepseek-700-delete': 'rgb(128, 207, 210)',
      '--dsw-static-deepseek-800': 'rgb(172, 227, 228)',
      '--dsw-static-deepseek-900': 'rgb(205, 239, 239)',
      '--dsw-static-blue-500': 'rgb(96, 190, 195)',
      '--dsw-alias-brand-primary': 'rgb(128, 207, 210)',
    },
  }),
  Object.freeze({
    id: 'violet',
    label: 'Violet · 紫罗兰',
    accent: 'rgb(127, 78, 203)',
    light: {
      '--dsw-static-deepseek-50': 'rgb(243, 237, 250)',
      '--dsw-static-deepseek-100': 'rgb(232, 219, 246)',
      '--dsw-static-deepseek-200': 'rgb(215, 195, 239)',
      '--dsw-static-deepseek-300': 'rgb(193, 163, 231)',
      '--dsw-static-deepseek-400': 'rgb(170, 131, 222)',
      '--dsw-static-deepseek-450': 'rgb(148, 102, 214)',
      '--dsw-static-deepseek-500': 'rgb(127, 78, 203)',
      '--dsw-static-deepseek-600': 'rgb(104, 62, 168)',
      '--dsw-static-deepseek-700-delete': 'rgb(85, 52, 137)',
      '--dsw-static-deepseek-800': 'rgb(68, 45, 108)',
      '--dsw-static-deepseek-900': 'rgb(50, 34, 79)',
      '--dsw-static-blue-500': 'rgb(127, 78, 203)',
      '--dsw-alias-brand-primary': 'rgb(127, 78, 203)',
    },
    dark: {
      '--dsw-static-deepseek-50': 'rgb(38, 26, 60)',
      '--dsw-static-deepseek-100': 'rgb(46, 31, 74)',
      '--dsw-static-deepseek-200': 'rgb(58, 40, 96)',
      '--dsw-static-deepseek-300': 'rgb(78, 54, 129)',
      '--dsw-static-deepseek-400': 'rgb(104, 72, 172)',
      '--dsw-static-deepseek-450': 'rgb(148, 102, 214)',
      '--dsw-static-deepseek-500': 'rgb(127, 78, 203)',
      '--dsw-static-deepseek-600': 'rgb(170, 131, 222)',
      '--dsw-static-deepseek-700-delete': 'rgb(193, 163, 231)',
      '--dsw-static-deepseek-800': 'rgb(215, 195, 239)',
      '--dsw-static-deepseek-900': 'rgb(232, 219, 246)',
      '--dsw-static-blue-500': 'rgb(170, 131, 222)',
      '--dsw-alias-brand-primary': 'rgb(193, 163, 231)',
    },
  }),
  Object.freeze({
    id: 'ember',
    label: 'Ember · 暖橙',
    accent: 'rgb(221, 92, 27)',
    light: {
      '--dsw-static-deepseek-50': 'rgb(253, 242, 233)',
      '--dsw-static-deepseek-100': 'rgb(251, 228, 211)',
      '--dsw-static-deepseek-200': 'rgb(248, 207, 178)',
      '--dsw-static-deepseek-300': 'rgb(244, 178, 134)',
      '--dsw-static-deepseek-400': 'rgb(240, 146, 89)',
      '--dsw-static-deepseek-450': 'rgb(233, 115, 50)',
      '--dsw-static-deepseek-500': 'rgb(221, 92, 27)',
      '--dsw-static-deepseek-600': 'rgb(184, 76, 24)',
      '--dsw-static-deepseek-700-delete': 'rgb(150, 63, 23)',
      '--dsw-static-deepseek-800': 'rgb(118, 52, 23)',
      '--dsw-static-deepseek-900': 'rgb(88, 40, 21)',
      '--dsw-static-blue-500': 'rgb(221, 92, 27)',
      '--dsw-alias-brand-primary': 'rgb(221, 92, 27)',
    },
    dark: {
      '--dsw-static-deepseek-50': 'rgb(52, 29, 18)',
      '--dsw-static-deepseek-100': 'rgb(64, 35, 20)',
      '--dsw-static-deepseek-200': 'rgb(84, 45, 23)',
      '--dsw-static-deepseek-300': 'rgb(114, 58, 25)',
      '--dsw-static-deepseek-400': 'rgb(155, 76, 28)',
      '--dsw-static-deepseek-450': 'rgb(233, 115, 50)',
      '--dsw-static-deepseek-500': 'rgb(221, 92, 27)',
      '--dsw-static-deepseek-600': 'rgb(240, 146, 89)',
      '--dsw-static-deepseek-700-delete': 'rgb(244, 178, 134)',
      '--dsw-static-deepseek-800': 'rgb(248, 207, 178)',
      '--dsw-static-deepseek-900': 'rgb(251, 228, 211)',
      '--dsw-static-blue-500': 'rgb(240, 146, 89)',
      '--dsw-alias-brand-primary': 'rgb(244, 178, 134)',
    },
  }),
  Object.freeze({
    id: 'rose',
    label: 'Rose · 玫瑰红',
    accent: 'rgb(202, 52, 101)',
    light: {
      '--dsw-static-deepseek-50': 'rgb(252, 237, 241)',
      '--dsw-static-deepseek-100': 'rgb(249, 219, 227)',
      '--dsw-static-deepseek-200': 'rgb(245, 193, 207)',
      '--dsw-static-deepseek-300': 'rgb(239, 157, 181)',
      '--dsw-static-deepseek-400': 'rgb(232, 118, 152)',
      '--dsw-static-deepseek-450': 'rgb(219, 82, 125)',
      '--dsw-static-deepseek-500': 'rgb(202, 52, 101)',
      '--dsw-static-deepseek-600': 'rgb(168, 43, 86)',
      '--dsw-static-deepseek-700-delete': 'rgb(137, 36, 72)',
      '--dsw-static-deepseek-800': 'rgb(109, 31, 59)',
      '--dsw-static-deepseek-900': 'rgb(82, 25, 46)',
      '--dsw-static-blue-500': 'rgb(202, 52, 101)',
      '--dsw-alias-brand-primary': 'rgb(202, 52, 101)',
    },
    dark: {
      '--dsw-static-deepseek-50': 'rgb(48, 21, 31)',
      '--dsw-static-deepseek-100': 'rgb(59, 24, 38)',
      '--dsw-static-deepseek-200': 'rgb(77, 29, 49)',
      '--dsw-static-deepseek-300': 'rgb(105, 35, 62)',
      '--dsw-static-deepseek-400': 'rgb(143, 42, 80)',
      '--dsw-static-deepseek-450': 'rgb(219, 82, 125)',
      '--dsw-static-deepseek-500': 'rgb(202, 52, 101)',
      '--dsw-static-deepseek-600': 'rgb(232, 118, 152)',
      '--dsw-static-deepseek-700-delete': 'rgb(239, 157, 181)',
      '--dsw-static-deepseek-800': 'rgb(245, 193, 207)',
      '--dsw-static-deepseek-900': 'rgb(249, 219, 227)',
      '--dsw-static-blue-500': 'rgb(232, 118, 152)',
      '--dsw-alias-brand-primary': 'rgb(239, 157, 181)',
    },
  }),
])

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
 * Base RGB triplets the translucent surfaces derive from (the official alias
 * token values for each palette). The user's transparency strength is folded
 * into each token's alpha at apply time.
 */
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

/**
 * Base RGB triplets for the aionui-panel plugin's surfaces (its own token
 * values, light palette). bg-1 is the panel body; bg-base backs its floating
 * layers (dialog/menu/toast).
 */
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

/**
 * Per-surface alpha reduction factor: how much of the user's transparency
 * strength each surface takes. Floating layers (overlay/menu/input/dialog)
 * stay more opaque than the page layers so they remain readable.
 */
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

/** Default scrollbar palette (light). */
const SCROLLBAR_LIGHT = Object.freeze({
  '--dsh-scrollbar-thumb': '#b4c3e8',
  '--dsh-scrollbar-thumb-hover': '#7f96d2',
  track: '#eef1f9',
  corner: '#eef1f9',
})

/** Default scrollbar palette (dark). */
const SCROLLBAR_DARK = Object.freeze({
  '--dsh-scrollbar-thumb': '#455678',
  '--dsh-scrollbar-thumb-hover': '#6276a5',
  track: '#141a2b',
  corner: '#141a2b',
})

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
 * silently drops the whole declaration — which is exactly why large "all
 * panels" source-bridge JPEGs never appeared while their `<img>` thumbnails
 * did. blob: URLs are short, so they are exempt; each unique image is decoded
 * once and reused for the module's lifetime (every re-apply — e.g. dragging a
 * scrim slider — is a cache hit, so no repeated base64 decode and no URL
 * churn). The browser releases blob URLs when the document unloads, and the
 * cache is naturally bounded by the distinct images used this session, so no
 * explicit revocation is needed.
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
 *  alpha is a CSS variable reference (global or per-panel) so moving a slider
 *  re-rasterizes live without rewriting the stylesheet. The variable always
 *  carries a `0` fallback: a missing variable would otherwise invalidate the
 *  whole declaration at computed-value time and background-image would fall
 *  back to `none`, silently killing the image layer too. The image is rendered
 *  through a blob URL when the environment supports it (see
 *  resolveBackgroundUrl). */
function backdropImage(image: string, scrim?: string): string {
  const alpha = scrim === undefined ? `var(${SCRIM_VARIABLE}, 0)` : `var(${scrim}, 0)`
  return `linear-gradient(rgba(10, 14, 28, ${alpha}) 0%, rgba(10, 14, 28, ${alpha}) 100%), url(${resolveBackgroundUrl(image)})`
}

/** Light/dark selectors scoping one panel's overrides to its own subtree.
 *  Every comma-separated alternative gets the personalization scope prefix —
 *  an unprefixed alternative would fall back to (0,1,0) specificity and lose
 *  to the official `background` shorthand on the columns. */
function scopeSelectors(id: PanelId): { light: string; dark: string } {
  const raw = PANEL_SCOPE_SELECTOR[id]
  const selectors = raw === ''
    ? []
    : raw.split(',').map(s => s.trim()).filter(s => s !== '')
  const light = selectors.length === 0
    ? SCOPE
    : selectors.map(sel => `${SCOPE} ${sel}`).join(', ')
  const dark = selectors.length === 0
    ? `${SCOPE}[data-ds-dark-theme]`
    : selectors.map(sel => `${SCOPE}[data-ds-dark-theme] ${sel}`).join(', ')
  return { light, dark }
}

/** Resolve a palette choice to its --dsw-* token tables (official shell). */
function dswPalette(palette: PanelConfig['palette']): { light: Record<string, string>; dark: Record<string, string> } | null {
  if (palette.accent !== null) {
    return { light: accentGroup(palette.accent), dark: accentGroup(palette.accent) }
  }
  const preset = PALETTE_PRESETS.find(p => p.id === palette.preset)
  if (preset === undefined) return null
  return { light: preset.light, dark: preset.dark }
}

/** Resolve a palette choice to its --aion-* accent tables (aionui panel). */
function aionPalette(palette: PanelConfig['palette']): { light: Record<string, string>; dark: Record<string, string> } | null {
  const accent = palette.accent ?? PALETTE_PRESETS.find(p => p.id === palette.preset)?.accent
  if (accent === undefined) return null
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
    parts.push(paletteRule(light, glassTokens(GLASS_BASE_LIGHT, pc.glass.opacity)))
    parts.push(paletteRule(dark, glassTokens(GLASS_BASE_DARK, pc.glass.opacity)))
    // No backdrop-filter here, deliberately: applying it to the frame columns
    // makes them the containing block for fixed-position descendants (the
    // settings modal, popovers), trapping those overlays inside the column —
    // the same boundary the dsh-web-ui skins document. Translucent token
    // backgrounds alone let the backdrop show through the layered surfaces.
  }
  const palette = dswPalette(pc.palette)
  if (palette !== null) {
    parts.push(paletteRule(light, palette.light), paletteRule(dark, palette.dark))
  }
  const { ui, code } = fontStacks(pc.font)
  if (ui !== '') parts.push(`${light}{--dsw-font-family:${ui}}`)
  if (code !== '') parts.push(`${light}{--ds-font-family-code:${code}}`)
  if (pc.scrollbar) {
    const lightColors = SCROLLBAR_LIGHT
    const darkColors = SCROLLBAR_DARK
    parts.push(
      `${light}{${declarations({ '--dsh-scrollbar-thumb': lightColors['--dsh-scrollbar-thumb'], '--dsh-scrollbar-thumb-hover': lightColors['--dsh-scrollbar-thumb-hover'] })}}`,
      `${light}::-webkit-scrollbar{width:10px;height:10px}`,
      `${light}::-webkit-scrollbar-track{background:${lightColors.track}}`,
      `${light}::-webkit-scrollbar-thumb{background:${lightColors['--dsh-scrollbar-thumb']};border:2px solid ${lightColors.track};border-radius:5px}`,
      `${light}::-webkit-scrollbar-thumb:hover{background:${lightColors['--dsh-scrollbar-thumb-hover']}}`,
      `${light}::-webkit-scrollbar-corner{background:${lightColors.corner}}`,
      `${dark}{${declarations({ '--dsh-scrollbar-thumb': darkColors['--dsh-scrollbar-thumb'], '--dsh-scrollbar-thumb-hover': darkColors['--dsh-scrollbar-thumb-hover'] })}}`,
      `${dark}::-webkit-scrollbar-track,${dark}::-webkit-scrollbar-corner{background:${darkColors.track}}`,
      `${dark}::-webkit-scrollbar-thumb{background:${darkColors['--dsh-scrollbar-thumb']};border-color:${darkColors.track}}`,
      `${dark}::-webkit-scrollbar-thumb:hover{background:${darkColors['--dsh-scrollbar-thumb-hover']}}`,
    )
  }
  if (pc.selection !== null) {
    parts.push(`${light}::selection{color:#fff;background:${pc.selection}}`)
  }
  return parts
}

/** The aionui right panel's rule set (its own --aion-* token group). */
function aionuiCss(scope: { light: string; dark: string }, pc: PanelConfig): string[] {
  const parts: string[] = []
  const { light, dark } = scope
  if (pc.glass.opacity > 0) {
    parts.push(paletteRule(light, glassTokens(AION_BASE_LIGHT, pc.glass.opacity)))
    parts.push(paletteRule(dark, glassTokens(AION_BASE_DARK, pc.glass.opacity)))
  }
  const palette = aionPalette(pc.palette)
  if (palette !== null) {
    parts.push(paletteRule(light, palette.light), paletteRule(dark, palette.dark))
  }
  const { ui, code } = fontStacks(pc.font)
  if (ui !== '') parts.push(`${light}{--aion-font-sans:${ui}}`)
  if (code !== '') parts.push(`${light}{--aion-font-mono:${code}}`)
  if (pc.scrollbar) {
    const lightColors = SCROLLBAR_LIGHT
    const darkColors = SCROLLBAR_DARK
    parts.push(
      `${light} ::-webkit-scrollbar{width:8px;height:8px}`,
      `${light} ::-webkit-scrollbar-thumb{background:${lightColors['--dsh-scrollbar-thumb']};border-radius:4px}`,
      `${light} ::-webkit-scrollbar-thumb:hover{background:${lightColors['--dsh-scrollbar-thumb-hover']}}`,
      `${light} ::-webkit-scrollbar-track{background:transparent}`,
      `${dark} ::-webkit-scrollbar-thumb{background:${darkColors['--dsh-scrollbar-thumb']}}`,
      `${dark} ::-webkit-scrollbar-thumb:hover{background:${darkColors['--dsh-scrollbar-thumb-hover']}}`,
    )
  }
  if (pc.selection !== null) {
    parts.push(`${light} ::selection{color:#fff;background:${pc.selection}}`)
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

/**
 * Apply the personalization configuration to the document.
 * @param config - the configuration to project.
 * @returns a disposer retracting every write (attribute, inline styles,
 * style tag, favicon link, document title).
 */
export function applyPersonalization(config: PersonalizationConfig): () => void {
  const body = document.body
  const previousBackdrop = new Map<string, string>()
  for (const prop of BACKDROP_PROPERTIES) previousBackdrop.set(prop, body.style.getPropertyValue(prop))
  const previousScrim = body.style.getPropertyValue(SCRIM_VARIABLE)
  const previousPanelScrims = new Map<string, string>()
  for (const id of PANEL_IDS) previousPanelScrims.set(scrimVariable(id), body.style.getPropertyValue(scrimVariable(id)))
  const previousTitle = document.title
  const previousFavicon = document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')

  // Body attribute activates the injected scope CSS.
  body.setAttribute(BODY_ATTRIBUTE, '')

  // The page-wide backdrop rides body inline styles (bottom layer, skin
  // protocol) with its scrim as a CSS variable; panel backdrops render at
  // each panel's own layer and stack over it.
  const globalBg = config.globalBackground.image
  const hasGlobalBg = globalBg !== null && globalBg !== undefined
  if (hasGlobalBg) {
    body.style.setProperty('background-image', backdropImage(globalBg))
    body.style.setProperty('background-position', 'center')
    body.style.setProperty('background-size', 'cover')
    body.style.setProperty('background-attachment', 'fixed')
    body.style.setProperty('background-repeat', 'no-repeat')
    body.style.setProperty(SCRIM_VARIABLE, String(config.globalBackground.scrim))
  }

  // Composite the injected stylesheet: page-wide rules, then one rule set
  // per panel driven by its resolved appearance.
  const cssParts: string[] = []
  if (hasGlobalBg) {
    cssParts.push(`${SCOPE} [id=root]{background:0 0}`)
    // A translucent base layer lets the page-wide backdrop show through the
    // frame under every column; each panel's own transparency and backdrop
    // decide how much of it reaches the surface.
    cssParts.push(paletteRule(`${SCOPE}`, glassTokens(GLASS_BASE_LIGHT, 0.5)))
    cssParts.push(paletteRule(`${SCOPE}[data-ds-dark-theme]`, glassTokens(GLASS_BASE_DARK, 0.5)))
  }
  for (const id of PANEL_IDS) {
    // Follow knobs inherit the "all panels" baseline; the engine styles the
    // resolved appearance.
    const pc = resolvePanelConfig(config.base, config.panels[id])
    const rules = panelCss(id, pc)
    // The backdrop image, when the background mode is 'image', renders at the
    // panel's layer; the panel's transparency slider controls how much of it
    // shows through the panel surfaces. 'solid' renders nothing — the panel
    // keeps its base color (still translucently, per its transparency).
    if (pc.background.mode === 'image' && pc.background.image !== null && pc.background.image !== undefined) {
      const scope = scopeSelectors(id)
      body.style.setProperty(scrimVariable(id), String(pc.background.scrim))
      rules.unshift(
        `${scope.light}{background-image:${backdropImage(pc.background.image, scrimVariable(id))};background-position:center;background-size:cover;background-repeat:no-repeat}`,
      )
    }
    cssParts.push(...rules)
  }
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-web-visualuiconfig'
  style.dataset.pluginCss = STYLE_TAG_ID
  style.textContent = cssParts.join('')
  document.head.appendChild(style)

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

  return () => {
    body.removeAttribute(BODY_ATTRIBUTE)
    for (const [prop, value] of previousBackdrop) body.style.setProperty(prop, value)
    body.style.setProperty(SCRIM_VARIABLE, previousScrim)
    for (const [name, value] of previousPanelScrims) body.style.setProperty(name, value)
    style.remove()
    if (favicon !== undefined) favicon.remove()
    if (document.title !== previousTitle) document.title = previousTitle
  }
}
