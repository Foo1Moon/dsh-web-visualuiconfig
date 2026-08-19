/**
 * The model-facing `personalization` tool: lets the agent change the Web GUI
 * appearance from natural language ("帮我把主题改成暖橙", "set a background
 * image", …). Structured optional arguments map onto a deep-merged config
 * patch; scalar validation throws descriptive errors the model can recover
 * from. Registered lazily through ctx.inject(['tools', 'systemPrompt']) — a
 * missing registry never blocks the plugin.
 *
 * The definition is a plain object (the tools registry validates the output
 * shape itself); `parameters` and `output.schema` are already-compiled JSON
 * Schema, since defineTool's spec→schema compilation happens in the harness
 * package this plugin deliberately does not import.
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { AssetStore } from './assets.ts'
import { PRESET_IDS, FONT_IDS, renderShow } from './commands.ts'
import { MAX_ASSET_BODY_BYTES, collectAssetHashes } from './routes.ts'
import type { PersonalSystemPrompt, PersonalToolDefinition, PersonalToolRuntime } from './types.ts'
import type { PersonalizationStore } from './store.ts'

/** Accepted tool arguments (all optional; nothing = show current state). */
export interface PersonalizationToolArgs {
  /** Custom accent hex (#rrggbb); overrides the preset. */
  accent?: string
  /** Accent palette preset id. */
  preset?: string
  /** Panel transparency 0..0.9. */
  transparency?: number
  /** Typography preset id. */
  font?: string
  /** Config storage mode. */
  storage?: 'host' | 'browser'
  /** Absolute path to a local image file to use as the panel background. */
  backgroundImage?: string
  /** Remove the current panel background image. */
  removeBackground?: boolean
  /** Master switch: false restores the official look immediately. */
  enabled?: boolean
  /** Reset everything to defaults. */
  reset?: boolean
}

/** Validate raw model arguments, throwing a descriptive Error on bad values. */
export function validateToolArgs(args: unknown): PersonalizationToolArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('personalization tool arguments must be an object')
  }
  const raw = args as Record<string, unknown>
  const out: PersonalizationToolArgs = {}
  if (raw.accent !== undefined) {
    if (typeof raw.accent !== 'string') throw new Error('accent must be a string hex color like #ff8800')
    const hex = /^#?([0-9a-f]{6})$/i.exec(raw.accent.trim())
    if (hex?.[1] === undefined) throw new Error(`accent must be a hex color like #ff8800, got "${raw.accent}"`)
    out.accent = `#${hex[1].toLowerCase()}`
  }
  if (raw.preset !== undefined) {
    if (typeof raw.preset !== 'string' || !PRESET_IDS.includes(raw.preset)) {
      throw new Error(`preset must be one of ${PRESET_IDS.join(', ')}, got "${String(raw.preset)}"`)
    }
    out.preset = raw.preset
  }
  if (raw.transparency !== undefined) {
    if (typeof raw.transparency !== 'number' || !Number.isFinite(raw.transparency)
      || raw.transparency < 0 || raw.transparency > 0.9) {
      throw new Error(`transparency must be a number between 0 and 0.9, got "${String(raw.transparency)}"`)
    }
    out.transparency = raw.transparency
  }
  if (raw.font !== undefined) {
    if (typeof raw.font !== 'string' || !FONT_IDS.includes(raw.font)) {
      throw new Error(`font must be one of ${FONT_IDS.join(', ')}, got "${String(raw.font)}"`)
    }
    out.font = raw.font
  }
  if (raw.storage !== undefined) {
    if (raw.storage !== 'host' && raw.storage !== 'browser') {
      throw new Error(`storage must be "host" or "browser", got "${String(raw.storage)}"`)
    }
    out.storage = raw.storage
  }
  if (raw.backgroundImage !== undefined) {
    if (typeof raw.backgroundImage !== 'string' || raw.backgroundImage.trim() === '') {
      throw new Error('backgroundImage must be a non-empty absolute file path')
    }
    out.backgroundImage = raw.backgroundImage
  }
  if (raw.removeBackground !== undefined) {
    if (typeof raw.removeBackground !== 'boolean') throw new Error('removeBackground must be a boolean')
    out.removeBackground = raw.removeBackground
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    out.enabled = raw.enabled
  }
  if (raw.reset !== undefined) {
    if (typeof raw.reset !== 'boolean') throw new Error('reset must be a boolean')
    out.reset = raw.reset
  }
  return out
}

/** Read a local image file, store it as an asset; throws descriptive errors.
 *  Shared with the character-theme tools (src/host/character-tool.ts). */
export async function storeLocalImage(path: string, assets: AssetStore): Promise<{ id: string }> {
  const ext = extname(path).slice(1).toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : undefined
  if (mime === undefined) {
    throw new Error(`unsupported image type ".${ext}"; use jpg/png/webp/gif`)
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error(`cannot read image file "${path}"`)
  }
  if (bytes.length > MAX_ASSET_BODY_BYTES) {
    throw new Error('image too large (limit 10 MB)')
  }
  const stored = await assets.save(bytes, mime)
  return { id: stored.id }
}

/** Build the config patch from validated args (does the asset I/O for images). */
async function buildPatch(input: PersonalizationToolArgs, store: PersonalizationStore, assets: AssetStore): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {}
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.storage !== undefined) patch.storageMode = input.storage
  const base: Record<string, unknown> = {}
  if (input.accent !== undefined) base.palette = { accent: input.accent, preset: '' }
  if (input.preset !== undefined) base.palette = { preset: input.preset, accent: null }
  if (input.transparency !== undefined) base.glass = { opacity: input.transparency }
  if (input.font !== undefined) base.font = { family: input.font }
  if (input.removeBackground === true) base.background = { mode: 'solid', image: null }
  if (input.backgroundImage !== undefined) {
    const stored = await storeLocalImage(input.backgroundImage, assets)
    const current = await store.getSnapshot()
    base.background = {
      mode: 'image',
      image: stored.id,
      scrim: current.config.base.background.scrim,
    }
  }
  if (Object.keys(base).length > 0) patch.base = base
  return patch
}

/**
 * Create the `personalization` tool definition (exported separately so tests
 * can drive `execute` without a registry).
 * @param store - the config store.
 * @param assets - the image asset store.
 * @returns the registry-ready tool definition.
 */
export function createPersonalizationToolDefinition(
  store: PersonalizationStore,
  assets: AssetStore,
): PersonalToolDefinition {
  return {
    name: 'personalization',
    description: 'Change the DSH Web GUI personalization: accent color (hex), palette preset (a preset id from the preset catalog), panel transparency (0-0.9), typography (default/rounded/serif/mono), background image (local file path), storage mode (host/browser), master enable switch, or reset everything. Call this when the user asks to change the GUI theme/appearance/background, in any language. Returns a confirmation with the new revision.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        accent: { type: 'string', description: 'Custom accent hex color, e.g. #ff8800 (overrides the preset).' },
        preset: { type: 'string', enum: [...PRESET_IDS], description: 'Accent palette preset id from the preset catalog (builtin skins and Catppuccin flavors included).' },
        transparency: { type: 'number', description: 'Panel transparency from 0 (opaque) to 0.9 (very transparent).' },
        font: { type: 'string', enum: [...FONT_IDS], description: 'Typography preset.' },
        storage: { type: 'string', enum: ['host', 'browser'], description: 'Where settings persist: host (machine file, follows across browsers) or browser (this browser only).' },
        backgroundImage: { type: 'string', description: 'Absolute path to a local image file (jpg/png/webp/gif) to use as the panel background.' },
        removeBackground: { type: 'boolean', description: 'Remove the current panel background image.' },
        enabled: { type: 'boolean', description: 'Master switch; false immediately restores the official look.' },
        reset: { type: 'boolean', description: 'Reset all personalization settings to defaults.' },
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
      const input = validateToolArgs(args)
      if (input.reset === true) {
        const snapshot = await store.reset()
        await assets.gc(new Set())
        return { message: `Personalization reset to defaults (revision ${snapshot.revision}).`, revision: snapshot.revision }
      }
      const patch = await buildPatch(input, store, assets)
      if (Object.keys(patch).length === 0) {
        // Nothing to change: report the current state.
        const snapshot = await store.getSnapshot()
        return { message: renderShow(snapshot), revision: snapshot.revision }
      }
      const snapshot = await store.patch(patch)
      await assets.gc(collectAssetHashes(snapshot.config))
      return { message: `Personalization updated (revision ${snapshot.revision}).`, revision: snapshot.revision }
    },
  }
}

/**
 * Register the `personalization` tool and its system-prompt guidance.
 * @param tools - the tool registry (lazily injected).
 * @param systemPrompt - the prompt section registry (lazily injected).
 * @param store - the config store.
 * @param assets - the image asset store.
 * @returns the tool disposer.
 */
export function registerPersonalizationTool(
  tools: PersonalToolRuntime,
  systemPrompt: PersonalSystemPrompt,
  store: PersonalizationStore,
  assets: AssetStore,
): () => void {
  systemPrompt.section({
    name: 'tool:personalization',
    order: 111,
    text: 'Use the personalization tool when the user asks to change the Web GUI theme, accent color, palette, background image, transparency, typography, or reset the appearance — in any language. It applies immediately and syncs to every open tab.',
  })

  return tools.register(createPersonalizationToolDefinition(store, assets))
}
