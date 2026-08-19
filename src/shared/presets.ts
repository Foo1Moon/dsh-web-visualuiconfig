/**
 * The palette-preset catalog: only the four built-in global themes are public.
 * The 21 single-scheme skins (from deepseek-harness-skin, MIT, © 2026 HeiGeAi —
 * the same project the OKLab derivation in src/shared/color.ts was ported
 * from) and the four Catppuccin flavors are kept as colour art assets
 * (SKIN_PRESET_ASSETS / CATPPUCCIN_PRESET_ASSETS) for future features but are
 * NOT exposed to users — the product surface is character themes + global
 * background only.
 *
 * Each preset resolves to per-scheme seeds; a single-scheme skin's opposite
 * scheme is derived as a neutral high-contrast variant of the same voice
 * colors, so it works in either light or dark UI.
 *
 * Shared by both halves: the client engine derives the `--dsw-*` ramp from
 * these seeds at apply time, the host command/tool layer validates preset ids
 * against PRESET_IDS, and the settings page renders the swatch cards.
 */
import type { PaletteSeeds } from './config.ts'

/** Which catalog group a preset belongs to (drives settings-page sections). */
export type PresetGroup = 'builtin' | 'skin' | 'catppuccin'

/** One palette preset: per-scheme seed sets, derived at apply time. */
export interface PalettePreset {
  /** Preset id ('' is the built-in look). */
  id: string
  /** Display label (the caller supplies the locale; zh label here). */
  label: string
  /** The preset's primary accent (drives the aionui ramp and the swatch). */
  accent: string
  /** Seeds for the light scheme. */
  light: PaletteSeeds
  /** Seeds for the dark scheme. */
  dark: PaletteSeeds
  /** Catalog group for the settings-page section. */
  group: PresetGroup
  /** The scheme the source skin declares; the other is a neutral variant.
   *  null for dual-scheme builtin presets. */
  appearance?: 'light' | 'dark'
}

/** Neutral opposite-scheme surfaces for single-scheme skins: high contrast,
 *  theme-agnostic, safe for any voice color. */
const LIGHT_NEUTRAL = { surface: '#ffffff', text: '#1a1a24' }
const DARK_NEUTRAL = { surface: '#17171e', text: '#eef1f8' }

/** The opposite-scheme variant of a single-scheme skin: same voice colors,
 *  neutral surface/text. */
function variant(seeds: PaletteSeeds, appearance: 'light' | 'dark'): PaletteSeeds {
  const neutral = appearance === 'light' ? DARK_NEUTRAL : LIGHT_NEUTRAL
  return { accent: seeds.accent, secondary: seeds.secondary, surface: neutral.surface, text: neutral.text }
}

/** Build a single-scheme skin preset (both schemes derived from one seed set). */
function skin(id: string, zh: string, appearance: 'light' | 'dark', seeds: PaletteSeeds): PalettePreset {
  return {
    id,
    label: zh,
    accent: seeds.accent,
    light: appearance === 'light' ? seeds : variant(seeds, 'dark'),
    dark: appearance === 'dark' ? seeds : variant(seeds, 'light'),
    group: 'skin',
    appearance,
  }
}

/** Build a Catppuccin flavor preset (same voice colors both schemes). */
function catppuccin(id: string, zh: string, appearance: 'light' | 'dark', seeds: PaletteSeeds): PalettePreset {
  return {
    id,
    label: zh,
    accent: seeds.accent,
    light: appearance === 'light' ? seeds : variant(seeds, 'dark'),
    dark: appearance === 'dark' ? seeds : variant(seeds, 'light'),
    group: 'catppuccin',
    appearance,
  }
}

/** Built-in presets: per-scheme seeds, derived at apply time. */
const BUILTIN: readonly PalettePreset[] = Object.freeze([
  Object.freeze({
    id: 'ocean', label: 'Ocean · 海洋青', group: 'builtin' as const,
    accent: '#1a8a92',
    light: { accent: '#1a8a92', secondary: '#4fb3b8', surface: '#ffffff', text: '#16202b' },
    dark: { accent: '#1a8a92', secondary: '#60bebf', surface: '#10162a', text: '#e9f1f6' },
  }),
  Object.freeze({
    id: 'violet', label: 'Violet · 紫罗兰', group: 'builtin' as const,
    accent: '#7f4ecb',
    light: { accent: '#7f4ecb', secondary: '#aa83de', surface: '#ffffff', text: '#241a38' },
    dark: { accent: '#7f4ecb', secondary: '#aa83de', surface: '#151022', text: '#eee8f8' },
  }),
  Object.freeze({
    id: 'ember', label: 'Ember · 暖橙', group: 'builtin' as const,
    accent: '#dd5c1b',
    light: { accent: '#dd5c1b', secondary: '#f09259', surface: '#ffffff', text: '#2b1a12' },
    dark: { accent: '#dd5c1b', secondary: '#e97332', surface: '#211309', text: '#fdf1e8' },
  }),
  Object.freeze({
    id: 'rose', label: 'Rose · 玫瑰红', group: 'builtin' as const,
    accent: '#ca3465',
    light: { accent: '#ca3465', secondary: '#e87698', surface: '#ffffff', text: '#2a1520' },
    dark: { accent: '#ca3465', secondary: '#db527d', surface: '#1d0f16', text: '#fdeef2' },
  }),
])

/** Colour art assets: 21 skins from deepseek-harness-skin (seeds + declared
 *  scheme). Kept for future features; NOT part of the public catalog. */
export const SKIN_PRESET_ASSETS: readonly PalettePreset[] = Object.freeze([
  skin('qq-2007', 'QQ 2007', 'light', { accent: '#1e6eb5', secondary: '#0b3c6d', surface: '#c3d5e6', text: '#1a1a1a' }),
  skin('qq-2008', 'QQ 2008·粉', 'light', { accent: '#c8447e', secondary: '#d98bb0', surface: '#f6e2ec', text: '#2b1020' }),
  skin('miku', '初音未来', 'light', { accent: '#19c9e5', secondary: '#ed6ec1', surface: '#f5f6fc', text: '#122c60' }),
  skin('genshin-light', '原神·蒙德', 'light', { accent: '#5b7fd6', secondary: '#e0aa3e', surface: '#f2f1fb', text: '#2c3a6b' }),
  skin('genshin-dark', '原神·璃月夜', 'dark', { accent: '#e0b458', secondary: '#7a86d8', surface: '#171a2e', text: '#f0e6c8' }),
  skin('deepspace-light', '恋与深空·星海', 'light', { accent: '#8f7fe8', secondary: '#f097c8', surface: '#f6f2fb', text: '#4a4668' }),
  skin('deepspace-dark', '恋与深空·星际', 'dark', { accent: '#9d8bff', secondary: '#f097c8', surface: '#201a40', text: '#e8e2ff' }),
  skin('naruto-naruto', '火影·鸣人', 'dark', { accent: '#f2801e', secondary: '#ffd166', surface: '#17110b', text: '#ffe3c2' }),
  skin('naruto-sasuke', '火影·佐助', 'dark', { accent: '#d8443c', secondary: '#7fb3ff', surface: '#171019', text: '#ffd9d2' }),
  skin('waves-1', '鸣潮·黑青', 'dark', { accent: '#3fd6d0', secondary: '#9aa8b0', surface: '#0d1418', text: '#d8eef0' }),
  skin('waves-2', '鸣潮·深紫', 'dark', { accent: '#56e0d8', secondary: '#a98fe8', surface: '#16121f', text: '#e4def2' }),
  skin('dragonball-nimbus', '龙珠·筋斗云', 'light', { accent: '#4fc3f7', secondary: '#f6c445', surface: '#f3f7ff', text: '#14213d' }),
  skin('dragonball-saiyan', '龙珠·超赛', 'light', { accent: '#f5c451', secondary: '#52c7f2', surface: '#fff8e8', text: '#282033' }),
  skin('dalao', '大佬·烟灰', 'dark', { accent: '#e09a52', secondary: '#9aa3b0', surface: '#111111', text: '#f2e8da' }),
  skin('deepseek-nv', 'DeepSeek 娘·深海', 'dark', { accent: '#5bbdf7', secondary: '#7fa3cf', surface: '#0c1c3e', text: '#dfeaf8' }),
  skin('deepseek-nv-q', 'DeepSeek 娘·Q版', 'light', { accent: '#5b8fe8', secondary: '#8fa8c6', surface: '#f4f7fc', text: '#1b2b45' }),
  skin('deepseek-qingchun', 'DeepSeek 青春版', 'light', { accent: '#2f92ea', secondary: '#8bb0cd', surface: '#f8fbfd', text: '#12293f' }),
  skin('neice-dalao', '内测大佬', 'dark', { accent: '#4aa8ff', secondary: '#6f7d99', surface: '#040f2b', text: '#d5e4fb' }),
  skin('bie-agi', '别影响 AGI', 'light', { accent: '#3f6fe0', secondary: '#8296bd', surface: '#eaf0fd', text: '#141f3a' }),
  skin('fengge', '峰哥骑鲸', 'light', { accent: '#2f6af2', secondary: '#8b9ab5', surface: '#f8f9fc', text: '#151b2b' }),
  skin('liangsheng', '梁圣·静音', 'light', { accent: '#12459f', secondary: '#8397b5', surface: '#f3f7fc', text: '#0d1c33' }),
])

/** Colour art assets: the four Catppuccin flavors (official palette: mauve
 *  accent, pink second). Kept for future features; NOT part of the public
 *  catalog. */
export const CATPPUCCIN_PRESET_ASSETS: readonly PalettePreset[] = Object.freeze([
  catppuccin('catppuccin-latte', 'Catppuccin · Latte', 'light', { accent: '#8839ef', secondary: '#ea76cb', surface: '#eff1f5', text: '#4c4f69' }),
  catppuccin('catppuccin-frappe', 'Catppuccin · Frappé', 'dark', { accent: '#ca9ee6', secondary: '#f4b8e4', surface: '#303446', text: '#c6d0f5' }),
  catppuccin('catppuccin-macchiato', 'Catppuccin · Macchiato', 'dark', { accent: '#c6a0f6', secondary: '#f5bde6', surface: '#24273a', text: '#cad3f5' }),
  catppuccin('catppuccin-mocha', 'Catppuccin · Mocha', 'dark', { accent: '#cba6f7', secondary: '#f5c2e7', surface: '#1e1e2e', text: '#cdd6f4' }),
])

/** The public preset catalog — the built-in global themes only. */
export const PALETTE_PRESETS: readonly PalettePreset[] = Object.freeze([...BUILTIN])

/** The accepted preset ids (drives host-side validation and tool enums). */
export const PRESET_IDS: readonly string[] = Object.freeze(PALETTE_PRESETS.map(p => p.id))
