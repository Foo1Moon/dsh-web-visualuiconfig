/**
 * The `/personalization` human-facing command: show or change the machine
 * personalization settings from the chat input, without touching the model.
 *
 * DSL: `show` (default), `set accent #hex`, `set preset ocean|violet|ember|rose`,
 * `set glass 0-0.9`, `set font default|rounded|serif|mono`,
 * `set storage host|browser`, `background set <image path>`, `background remove`,
 * `reset`. The parsing is a pure function so the grammar is unit-testable;
 * the runner operates on the store and asset store directly (in-process, so a
 * background image can be given as a local file path).
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { AssetStore } from './assets.ts'
import { MAX_ASSET_BODY_BYTES, collectAssetHashes } from './routes.ts'
import type { PersonalCommandResult } from './types.ts'
import type { StoreSnapshot, PersonalizationStore } from './store.ts'

/** The accepted preset ids (mirrors PALETTE_PRESETS in the client engine). */
export const PRESET_IDS: readonly string[] = Object.freeze(['ocean', 'violet', 'ember', 'rose'])
/** The accepted font ids (mirrors FONT_PRESETS in the client engine). */
export const FONT_IDS: readonly string[] = Object.freeze(['default', 'rounded', 'serif', 'mono'])
/** File extension → upload MIME type for `background set`. */
const EXT_MIME: Readonly<Record<string, string>> = Object.freeze({
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
  'gif': 'image/gif',
})

/** Usage text appended to every invalid invocation. */
export const USAGE = 'Usage: /personalization [show] | set <accent #hex | preset ocean|violet|ember|rose | glass 0-0.9 | font default|rounded|serif|mono | storage host|browser> <value> | background set <image path> | background remove | reset'

/** One parsed command action. */
export type PersonalizationAction =
  | { kind: 'show' }
  | { kind: 'reset' }
  | { kind: 'set-accent'; accent: string }
  | { kind: 'set-preset'; preset: string }
  | { kind: 'set-glass'; opacity: number }
  | { kind: 'set-font'; family: string }
  | { kind: 'set-storage'; mode: 'host' | 'browser' }
  | { kind: 'background-set'; path: string }
  | { kind: 'background-remove' }
  | { kind: 'invalid'; reason: string }

/** Normalize a hex color (with or without #) to `#rrggbb`. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(input.trim())
  return match?.[1] === undefined ? null : `#${match[1].toLowerCase()}`
}

/** Parse a raw command input (pure; grammar only, no I/O). */
export function parsePersonalizationInput(raw: string): PersonalizationAction {
  const input = raw.trim()
  if (input === '' || /^show$/i.test(input)) return { kind: 'show' }
  if (/^reset$/i.test(input)) return { kind: 'reset' }

  const accent = /^set\s+accent\s+(.+)$/i.exec(input)
  if (accent !== null) {
    const hex = normalizeHex(accent[1] ?? '')
    return hex === null ? { kind: 'invalid', reason: 'accent must be a hex color like #ff8800' } : { kind: 'set-accent', accent: hex }
  }

  const preset = /^set\s+preset\s+(\w+)$/i.exec(input)
  if (preset !== null) {
    const id = (preset[1] ?? '').toLowerCase()
    return PRESET_IDS.includes(id)
      ? { kind: 'set-preset', preset: id }
      : { kind: 'invalid', reason: `unknown preset "${preset[1]}"; choose ${PRESET_IDS.join(', ')}` }
  }

  const glass = /^set\s+glass\s+([0-9]+(?:\.[0-9]+)?)$/.exec(input)
  if (glass !== null) {
    const opacity = Number(glass[1])
    return Number.isFinite(opacity) && opacity >= 0 && opacity <= 0.9
      ? { kind: 'set-glass', opacity }
      : { kind: 'invalid', reason: 'glass opacity must be between 0 and 0.9' }
  }

  const font = /^set\s+font\s+(\w+)$/i.exec(input)
  if (font !== null) {
    const id = (font[1] ?? '').toLowerCase()
    return FONT_IDS.includes(id)
      ? { kind: 'set-font', family: id }
      : { kind: 'invalid', reason: `unknown font "${font[1]}"; choose ${FONT_IDS.join(', ')}` }
  }

  const storage = /^set\s+storage\s+(host|browser)$/i.exec(input)
  if (storage !== null) {
    return { kind: 'set-storage', mode: storage[1] === 'host' ? 'host' : 'browser' }
  }

  const bgSet = /^background\s+set\s+(.+)$/i.exec(input)
  if (bgSet !== null) {
    const path = bgSet[1]?.trim() ?? ''
    return path === '' ? { kind: 'invalid', reason: 'background set needs an image path' } : { kind: 'background-set', path }
  }

  if (/^background\s+remove$/i.test(input)) return { kind: 'background-remove' }

  return { kind: 'invalid', reason: 'unrecognized input' }
}

/** Render a human-readable summary of the current config (shared with the
 *  personalization tool). */
export function renderShow(snapshot: StoreSnapshot): string {
  const c = snapshot.config
  const accent = c.base.palette.accent !== null
    ? c.base.palette.accent
    : c.base.palette.preset !== ''
      ? `preset "${c.base.palette.preset}"`
      : 'none'
  const font = c.base.font.custom.trim() !== '' ? `custom: ${c.base.font.custom}` : c.base.font.family
  const background = c.base.background.mode === 'image' && c.base.background.image !== null
    ? c.base.background.image
    : 'none'
  return [
    `Personalization (revision ${snapshot.revision})`,
    `  storage: ${c.storageMode}`,
    `  enabled: ${c.enabled ? 'yes' : 'no'}`,
    `  accent: ${accent}`,
    `  transparency: ${c.base.glass.opacity.toFixed(2)}`,
    `  font: ${font}`,
    `  background: ${background}`,
    `  global background: ${c.globalBackground.image !== null ? 'yes' : 'no'}`,
    `  title: ${c.chrome.title ?? 'none'}`,
    '',
    USAGE,
  ].join('\n')
}

/** Execute a parsed raw input against the store and asset store. */
export async function runPersonalizationCommand(
  raw: string,
  store: PersonalizationStore,
  assets: AssetStore,
): Promise<PersonalCommandResult> {
  const action = parsePersonalizationInput(raw)
  switch (action.kind) {
    case 'show': {
      const snapshot = await store.getSnapshot()
      return { kind: 'success', text: renderShow(snapshot) }
    }
    case 'reset': {
      const snapshot = await store.reset()
      await assets.gc(new Set())
      return { kind: 'success', text: `Personalization reset to defaults (revision ${snapshot.revision}).` }
    }
    case 'set-accent': {
      const snapshot = await store.patch({ base: { palette: { accent: action.accent, preset: '' } } })
      return { kind: 'success', text: `Accent set to ${action.accent} (revision ${snapshot.revision}).` }
    }
    case 'set-preset': {
      const snapshot = await store.patch({ base: { palette: { preset: action.preset, accent: null } } })
      return { kind: 'success', text: `Preset "${action.preset}" applied (revision ${snapshot.revision}).` }
    }
    case 'set-glass': {
      const snapshot = await store.patch({ base: { glass: { opacity: action.opacity } } })
      return { kind: 'success', text: `Transparency set to ${action.opacity.toFixed(2)} (revision ${snapshot.revision}).` }
    }
    case 'set-font': {
      const snapshot = await store.patch({ base: { font: { family: action.family } } })
      return { kind: 'success', text: `Font set to "${action.family}" (revision ${snapshot.revision}).` }
    }
    case 'set-storage': {
      const snapshot = await store.patch({ storageMode: action.mode })
      return { kind: 'success', text: `Storage set to "${action.mode}" (revision ${snapshot.revision}).` }
    }
    case 'background-remove': {
      const snapshot = await store.patch({ base: { background: { mode: 'solid', image: null } } })
      await assets.gc(collectAssetHashes(snapshot.config))
      return { kind: 'success', text: `Background removed (revision ${snapshot.revision}).` }
    }
    case 'background-set': {
      return setBackground(action.path, store, assets)
    }
    case 'invalid':
      return { kind: 'error', text: `${action.reason}.\n${USAGE}` }
  }
}

/** Read a local image file, store it as an asset, and apply it to the baseline. */
async function setBackground(path: string, store: PersonalizationStore, assets: AssetStore): Promise<PersonalCommandResult> {
  const mime = EXT_MIME[extname(path).slice(1).toLowerCase()]
  if (mime === undefined) {
    return { kind: 'error', text: `unsupported image type "${extname(path)}"; use jpg/png/webp/gif` }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return { kind: 'error', text: `cannot read "${path}"` }
  }
  if (bytes.length > MAX_ASSET_BODY_BYTES) {
    return { kind: 'error', text: 'image too large (limit 10 MB)' }
  }
  try {
    const stored = await assets.save(bytes, mime)
    const current = await store.getSnapshot()
    const scrim = current.config.base.background.scrim
    const snapshot = await store.patch({ base: { background: { mode: 'image', image: stored.id, scrim } } })
    return { kind: 'success', text: `Background set to ${stored.id} (revision ${snapshot.revision}).` }
  } catch (error) {
    return { kind: 'error', text: `failed to store the image: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Register the `/personalization` command on a commands runtime. */
export function registerPersonalizationCommand(
  commands: { register(definition: {
    name: string
    description: string
    input: { hint: string }
    handler: (invocation: { rawInput: string }) => PersonalCommandResult | Promise<PersonalCommandResult>
  }): () => void },
  store: PersonalizationStore,
  assets: AssetStore,
): () => void {
  return commands.register({
    name: 'personalization',
    description: 'show or change personalization settings (accent, transparency, font, background image, storage)',
    input: { hint: 'show | set <accent #hex|preset ocean|violet|ember|rose|glass 0-0.9|font default|rounded|serif|mono|storage host|browser> <value> | background set <image path> | background remove | reset' },
    handler: invocation => runPersonalizationCommand(invocation.rawInput, store, assets),
  })
}
