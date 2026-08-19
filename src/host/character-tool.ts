/**
 * The model-facing character-theme tools: build a GUI theme from an anime
 * character's art and introduction.
 *
 * The model is the semantic engine — it reads the character art with
 * `read_image`, reads the introduction with `read`, derives the appearance
 * decisions (accent/preset/font/transparency/scrollbar/selection/background/
 * favicon/title) and hands them to `character_theme`, which stores the art as
 * an asset, overlays the theme on the live config (see src/shared/theme.ts)
 * and records it in the theme library. `character_theme_manage` lists,
 * switches, deactivates and removes saved themes.
 *
 * Both tools are registered lazily through ctx.inject(['tools',
 * 'systemPrompt']) — a missing registry never blocks the plugin. Definitions
 * are plain objects (the tools registry validates the shape itself); the
 * parameters are already-compiled JSON Schema, exactly like the
 * `personalization` tool.
 */
import type { AssetStore } from './assets.ts'
import type { CharacterTheme, PaletteSeeds } from '../shared/config.ts'
import { themeIdFromName } from '../shared/config.ts'
import {
  activateTheme,
  buildThemePatch,
  deactivateTheme,
  findTheme,
  removeTheme,
  type ThemeStyleInput,
} from '../shared/theme.ts'
import type { PersonalSystemPrompt, PersonalToolDefinition, PersonalToolRuntime } from './types.ts'
import type { PersonalizationStore } from './store.ts'
import { PRESET_IDS, FONT_IDS } from './commands.ts'
import { collectAssetHashes } from './routes.ts'
import { storeLocalImage } from './tool.ts'

/** Accepted `character_theme` arguments (all optional; `name` validated in
 *  execute because an apply with no decisions is meaningless). */
export interface CharacterThemeToolArgs {
  /** Character/theme display name — the natural key. */
  name?: string
  /** The character introduction (truncated to 2000 chars). */
  description?: string
  /** Absolute path to the character art (jpg/png/webp/gif). */
  imagePath?: string
  /** Custom accent hex derived from the character's iconic color. */
  accent?: string
  /** Accent palette preset closest to the character's palette. */
  preset?: string
  /**
   * The four palette seeds derived from the character (accent / secondary /
   * surface / text). When set, the engine derives the whole `--dsw-static-*`
   * ramp from them with contrast preservation, instead of the accent/preset
   * fallbacks.
   */
  seeds?: PaletteSeeds
  /** The scheme the seeds were derived for; pins the UI while the theme is active. */
  appearance?: 'light' | 'dark'
  /** Typography preset matching the character's personality. */
  font?: string
  /** Panel transparency 0..0.9. */
  transparency?: number
  /** Restyle the scrollbar to match the theme. */
  scrollbar?: boolean
  /** Text-selection hex color. */
  selection?: string
  /** Use the character art as the page-wide backdrop (default false). */
  background?: boolean
  /** Scrim alpha over the backdrop image, 0..1. */
  scrim?: number
  /** Use the character art as the favicon (default false). */
  favicon?: boolean
  /** Page title override (usually the character name). */
  title?: string
}

/** Accepted `character_theme_manage` arguments. */
export interface CharacterThemeManageArgs {
  /** What to do with the theme library. */
  action?: 'list' | 'switch' | 'deactivate' | 'remove'
  /** Theme id or name (required for switch/remove). */
  name?: string
}

/** The accepted manage actions. */
export const MANAGE_ACTIONS: readonly string[] = Object.freeze(['list', 'switch', 'deactivate', 'remove'])

/** Validate raw `character_theme` arguments, normalizing hex colors. */
export function validateCharacterThemeArgs(args: unknown): CharacterThemeToolArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('character_theme arguments must be an object')
  }
  const raw = args as Record<string, unknown>
  const out: CharacterThemeToolArgs = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') throw new Error('name must be a non-empty string')
    out.name = raw.name.trim().slice(0, 64)
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') throw new Error('description must be a string')
    out.description = raw.description.trim().slice(0, 2000)
  }
  if (raw.imagePath !== undefined) {
    if (typeof raw.imagePath !== 'string' || raw.imagePath.trim() === '') {
      throw new Error('imagePath must be a non-empty absolute file path')
    }
    out.imagePath = raw.imagePath
  }
  if (raw.accent !== undefined) {
    if (typeof raw.accent !== 'string') throw new Error('accent must be a hex color like #ff6b9d')
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw.accent.trim())
    if (hex?.[1] === undefined) throw new Error(`accent must be a hex color like #ff6b9d, got "${raw.accent}"`)
    out.accent = `#${hex[1].toLowerCase()}`
  }
  if (raw.preset !== undefined) {
    if (typeof raw.preset !== 'string' || !PRESET_IDS.includes(raw.preset)) {
      throw new Error(`preset must be one of ${PRESET_IDS.join(', ')}, got "${String(raw.preset)}"`)
    }
    out.preset = raw.preset
  }
  if (raw.seeds !== undefined) {
    if (typeof raw.seeds !== 'object' || raw.seeds === null || Array.isArray(raw.seeds)) {
      throw new Error('seeds must be an object with accent, secondary, surface, text hex colors')
    }
    const s = raw.seeds as Record<string, unknown>
    const hexOf = (key: string): string | null => {
      const value = s[key]
      if (typeof value !== 'string') return null
      const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim())
      return hex?.[1] === undefined ? null : `#${hex[1].toLowerCase()}`
    }
    const accent = hexOf('accent')
    const secondary = hexOf('secondary')
    const surface = hexOf('surface')
    const text = hexOf('text')
    if (accent === null || secondary === null || surface === null || text === null) {
      throw new Error('seeds must carry four hex colors: accent, secondary, surface, text')
    }
    out.seeds = { accent, secondary, surface, text }
  }
  if (raw.appearance !== undefined) {
    if (raw.appearance !== 'light' && raw.appearance !== 'dark') {
      throw new Error('appearance must be "light" or "dark"')
    }
    out.appearance = raw.appearance
  }
  if (raw.font !== undefined) {
    if (typeof raw.font !== 'string' || !FONT_IDS.includes(raw.font)) {
      throw new Error(`font must be one of ${FONT_IDS.join(', ')}, got "${String(raw.font)}"`)
    }
    out.font = raw.font
  }
  if (raw.transparency !== undefined) {
    if (typeof raw.transparency !== 'number' || !Number.isFinite(raw.transparency)
      || raw.transparency < 0 || raw.transparency > 0.9) {
      throw new Error(`transparency must be a number between 0 and 0.9, got "${String(raw.transparency)}"`)
    }
    out.transparency = raw.transparency
  }
  if (raw.scrollbar !== undefined) {
    if (typeof raw.scrollbar !== 'boolean') throw new Error('scrollbar must be a boolean')
    out.scrollbar = raw.scrollbar
  }
  if (raw.selection !== undefined) {
    if (typeof raw.selection !== 'string') throw new Error('selection must be a hex color like #ff6b9d')
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw.selection.trim())
    if (hex?.[1] === undefined) throw new Error(`selection must be a hex color like #ff6b9d, got "${raw.selection}"`)
    out.selection = `#${hex[1].toLowerCase()}`
  }
  if (raw.background !== undefined) {
    if (typeof raw.background !== 'boolean') throw new Error('background must be a boolean')
    out.background = raw.background
  }
  if (raw.scrim !== undefined) {
    if (typeof raw.scrim !== 'number' || !Number.isFinite(raw.scrim) || raw.scrim < 0 || raw.scrim > 1) {
      throw new Error(`scrim must be a number between 0 and 1, got "${String(raw.scrim)}"`)
    }
    out.scrim = raw.scrim
  }
  if (raw.favicon !== undefined) {
    if (typeof raw.favicon !== 'boolean') throw new Error('favicon must be a boolean')
    out.favicon = raw.favicon
  }
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string' || raw.title.trim() === '') throw new Error('title must be a non-empty string')
    out.title = raw.title.trim().slice(0, 64)
  }
  return out
}

/** Validate raw `character_theme_manage` arguments (action defaults to list). */
export function validateManageArgs(args: unknown): CharacterThemeManageArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('character_theme_manage arguments must be an object')
  }
  const raw = args as Record<string, unknown>
  const action = typeof raw.action === 'string' && raw.action !== '' ? raw.action : 'list'
  if (!MANAGE_ACTIONS.includes(action)) {
    throw new Error(`action must be one of ${MANAGE_ACTIONS.join(', ')}, got "${action}"`)
  }
  const out: CharacterThemeManageArgs = { action: action as CharacterThemeManageArgs['action'] }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') throw new Error('name must be a non-empty theme id or name')
    out.name = raw.name.trim()
  }
  if ((action === 'switch' || action === 'remove') && out.name === undefined) {
    throw new Error(`action "${action}" requires a name (theme id or name)`)
  }
  return out
}

/** The `character_theme` tool definition (exported for tests). */
export function createCharacterThemeToolDefinition(
  store: PersonalizationStore,
  assets: AssetStore,
): PersonalToolDefinition {
  return {
    name: 'character_theme',
    description: 'Build and apply a GUI theme from an anime character: store the character art as an asset, overlay the derived appearance (accent/preset/font/transparency/scrollbar/selection, optionally the art as page-wide background or favicon, and a page title) on the DSH Web GUI, and save it in the character theme library. Call this only after the user has reviewed and confirmed the proposed scheme (see the tool:character-theme system guidance — propose first, apply on confirmation); the same name re-applies (replaces) the theme. Manage the library with character_theme_manage.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Character/theme display name — the natural key; re-applying the same name replaces the theme.' },
        description: { type: 'string', description: 'The character introduction (up to 2000 chars).' },
        imagePath: { type: 'string', description: 'Absolute path to the character art image (jpg/png/webp/gif).' },
        accent: { type: 'string', description: 'Custom accent hex color derived from the character, e.g. #ff6b9d.' },
        preset: { type: 'string', enum: [...PRESET_IDS], description: 'Accent palette preset closest to the character palette.' },
        seeds: {
          type: 'object',
          additionalProperties: false,
          properties: {
            accent: { type: 'string', description: 'Primary voice color as hex, e.g. #ff6b9d.' },
            secondary: { type: 'string', description: 'Second voice color as hex.' },
            surface: { type: 'string', description: 'Page background color as hex.' },
            text: { type: 'string', description: 'Text color anchor as hex.' },
          },
          description: 'Four palette seeds derived from the character; the engine derives the whole contrast-preserving ramp from them (preferred over accent/preset).',
        },
        appearance: { type: 'string', enum: ['light', 'dark'], description: 'The scheme the seeds were derived for; pins the UI while the theme is active.' },
        font: { type: 'string', enum: [...FONT_IDS], description: 'Typography preset matching the character personality.' },
        transparency: { type: 'number', description: 'Panel transparency 0 (opaque) to 0.9 (very transparent).' },
        scrollbar: { type: 'boolean', description: 'Restyle the scrollbar to match the theme.' },
        selection: { type: 'string', description: 'Text-selection hex color, e.g. #ff6b9d.' },
        background: { type: 'boolean', description: 'Use the character art as the page-wide backdrop (default false — hurts readability).' },
        scrim: { type: 'number', description: 'Backdrop scrim alpha 0..1 to darken the art for readability.' },
        favicon: { type: 'boolean', description: 'Use the character art as the favicon (default false).' },
        title: { type: 'string', description: 'Page title override (usually the character name).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
          revision: { type: 'integer' },
        },
      },
      render: (_args, value) => {
        const text = (value as { message?: unknown }).message
        return [{ type: 'text', text: typeof text === 'string' ? text : String(value) }]
      },
    },
    async execute(args) {
      const input = validateCharacterThemeArgs(args)
      const name = input.name ?? ''
      if (name === '') throw new Error('name is required: the character/theme display name')
      const hasImage = input.imagePath !== undefined && input.imagePath !== ''
      const hasDecision = hasImage
        || input.accent !== undefined || input.preset !== undefined || input.seeds !== undefined
        || input.font !== undefined
        || input.transparency !== undefined || input.scrollbar !== undefined || input.selection !== undefined
        || input.background === true || input.favicon === true || input.title !== undefined
      if (!hasDecision) {
        throw new Error('provide a character image (imagePath) or at least one appearance decision (seeds/accent/preset/font/transparency/scrollbar/selection/background/favicon/title)')
      }
      if ((input.background === true || input.favicon === true) && !hasImage) {
        throw new Error('background and favicon need imagePath (the stored character art)')
      }

      // Store the character art (if any) before touching the store.
      let sourceImage: string | null = null
      if (hasImage) {
        const stored = await storeLocalImage(input.imagePath as string, assets)
        sourceImage = stored.id
      }

      const snapshot = await store.getSnapshot()
      const existing = findTheme(snapshot.config, name)
      const style: ThemeStyleInput = {
        accent: input.accent,
        preset: input.preset,
        seeds: input.seeds,
        appearance: input.appearance,
        font: input.font,
        transparency: input.transparency,
        scrollbar: input.scrollbar,
        selection: input.selection,
        useBackground: input.background === true,
        scrim: input.scrim,
        useFavicon: input.favicon === true,
        title: input.title,
      }
      const theme: Omit<CharacterTheme, 'snapshot'> = {
        id: existing?.id ?? themeIdFromName(name),
        name,
        description: (input.description ?? '').slice(0, 2000),
        sourceImage,
        ...(input.seeds !== undefined ? { seeds: input.seeds } : {}),
        ...(input.appearance !== undefined ? { appearance: input.appearance } : {}),
        createdAt: existing?.createdAt ?? Date.now(),
        patch: buildThemePatch(style, sourceImage),
      }
      const next = activateTheme(snapshot.config, theme)
      const result = await store.update(next)
      await assets.gc(collectAssetHashes(result.config))
      return {
        message: `Character theme "${name}" applied (revision ${result.revision}). Use character_theme_manage to list, switch, deactivate, or remove themes.`,
        revision: result.revision,
      }
    },
  }
}

/** The `character_theme_manage` tool definition (exported for tests). */
export function createCharacterThemeManageToolDefinition(
  store: PersonalizationStore,
  assets: AssetStore,
): PersonalToolDefinition {
  return {
    name: 'character_theme_manage',
    description: 'Manage the saved character theme library: list saved themes, switch to a saved theme, deactivate the current theme (restore the pre-theme look), or remove a theme. Switching replaces the current theme look with the target theme; deactivating returns exactly to the appearance from before the theme was activated.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: [...MANAGE_ACTIONS], description: 'list (default) | switch | deactivate | remove.' },
        name: { type: 'string', description: 'Theme id or display name (required for switch and remove).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
          revision: { type: 'integer' },
        },
      },
      render: (_args, value) => {
        const text = (value as { message?: unknown }).message
        return [{ type: 'text', text: typeof text === 'string' ? text : String(value) }]
      },
    },
    async execute(args) {
      const input = validateManageArgs(args)
      const snapshot = await store.getSnapshot()
      switch (input.action) {
        case 'list': {
          const { config, revision } = snapshot
          if (config.themes.list.length === 0) {
            return {
              message: `No character themes yet (revision ${revision}). Create one with character_theme.`,
              revision,
            }
          }
          const lines = config.themes.list.map(theme => {
            const active = config.themes.active === theme.id ? ' [active]' : ''
            const desc = theme.description !== '' ? ` — ${theme.description.slice(0, 60)}` : ''
            return `- ${theme.id}  "${theme.name}"${active}${desc}`
          })
          return {
            message: `Character themes (revision ${revision}):\n${lines.join('\n')}\n\nSwitch with { action: "switch", name: "<id or name>" }, deactivate with { action: "deactivate" }, remove with { action: "remove", name: "<id or name>" }.`,
            revision,
          }
        }
        case 'switch': {
          const theme = findTheme(snapshot.config, input.name ?? '')
          if (theme === undefined) {
            throw new Error(`no character theme named "${input.name}"; list themes with character_theme_manage { action: "list" }`)
          }
          const next = activateTheme(snapshot.config, theme)
          const result = await store.update(next)
          await assets.gc(collectAssetHashes(result.config))
          return { message: `Switched to character theme "${theme.name}" (revision ${result.revision}).`, revision: result.revision }
        }
        case 'deactivate': {
          if (snapshot.config.themes.active === null) {
            return { message: `No character theme is active (revision ${snapshot.revision}).`, revision: snapshot.revision }
          }
          const next = deactivateTheme(snapshot.config)
          const result = await store.update(next)
          await assets.gc(collectAssetHashes(result.config))
          return { message: `Character theme deactivated; appearance restored (revision ${result.revision}).`, revision: result.revision }
        }
        case 'remove': {
          const theme = findTheme(snapshot.config, input.name ?? '')
          if (theme === undefined) {
            throw new Error(`no character theme named "${input.name}"; list themes with character_theme_manage { action: "list" }`)
          }
          const next = removeTheme(snapshot.config, theme.id)
          const result = await store.update(next)
          await assets.gc(collectAssetHashes(result.config))
          return { message: `Character theme "${theme.name}" removed (revision ${result.revision}).`, revision: result.revision }
        }
      }
    },
  }
}

/** Register both character-theme tools plus the derivation guidance. */
export function registerCharacterThemeTools(
  tools: PersonalToolRuntime,
  systemPrompt: PersonalSystemPrompt,
  store: PersonalizationStore,
  assets: AssetStore,
): () => void {
  systemPrompt.section({
    name: 'tool:character-theme',
    order: 112,
    text: 'To build a character-styled GUI theme from an anime/manga character, follow the two-phase protocol: PROPOSE first, then APPLY only after the user confirms. Never call character_theme in the same turn in which you first read the art.\n\nPhase 1 — propose (no apply): read the character art with read_image (local file path) and the user\'s introduction with read. Derive 2-3 candidate schemes, each with a different hook into the character (e.g. A: accent from the hair color, B: from the eye color, C: from the outfit). For every candidate present: its four palette seeds (accent: that hook\'s color as a hex, choosing a tone with enough contrast against the panels; secondary: a second voice color; surface: a page background color matching the art\'s mood; text: a readable text color for that surface); appearance: the scheme (light/dark) the art suggests; font: the personality (cute/soft/gentle → rounded, elegant/classical/refined → serif, cool/tech/cyber → mono, otherwise default); transparency (0–0.9) and scrim (0–1): the mood (ethereal/light/airy → more transparent, dark/serious/dense → less); whether scrollbar and selection follow the palette; and a one-line summary of the vibe each candidate conveys. Keep background=false unless the user explicitly wants the art as a backdrop — a full-bleed character image hurts readability. Set title to the character name. Present the candidates and ask which one the user prefers — do not apply anything yet.\n\nPhase 2 — discuss and iterate: revise the proposal from feedback (e.g. too dark, too pink, too rounded) and re-propose until the user is satisfied. Do not call character_theme before an explicit confirmation.\n\nPhase 3 — apply: only after the user explicitly confirms, call character_theme with the agreed values (seeds are preferred over a bare accent — the engine derives the whole contrast-preserving ramp from them); manage the library (list/switch/deactivate/remove) with character_theme_manage. The theme applies immediately and syncs to every open tab; after applying, offer fine-tuning (accent/transparency/font) or deactivation as follow-ups.\n\nShortcut: if the user explicitly says to skip the discussion (e.g. "直接做吧", "you decide"), skip the proposal and apply a single recommended scheme directly.',
  })

  const offApply = tools.register(createCharacterThemeToolDefinition(store, assets))
  const offManage = tools.register(createCharacterThemeManageToolDefinition(store, assets))
  return () => {
    offApply()
    offManage()
  }
}
