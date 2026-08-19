/**
 * Preset catalog integrity: the PUBLIC catalog carries only the built-in
 * global themes; the skin / Catppuccin colour art assets stay out of it (and
 * out of PRESET_IDS) but keep their own integrity — unique ids, valid
 * per-scheme seeds, declared scheme preserved verbatim, opposite scheme a
 * neutral high-contrast variant.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PALETTE_PRESETS,
  PRESET_IDS,
  SKIN_PRESET_ASSETS,
  CATPPUCCIN_PRESET_ASSETS,
  type PalettePreset,
} from '../../src/shared/presets.ts'

const HEX = /^#[0-9a-f]{6}$/

function validSeeds(seeds: unknown): seeds is { accent: string; secondary: string; surface: string; text: string } {
  if (typeof seeds !== 'object' || seeds === null) return false
  const s = seeds as Record<string, unknown>
  return ['accent', 'secondary', 'surface', 'text'].every(k => typeof s[k] === 'string' && HEX.test(s[k] as string))
}

test('public catalog carries only the built-in global themes', () => {
  assert.equal(PALETTE_PRESETS.length, 4)
  assert.ok(PALETTE_PRESETS.every(p => p.group === 'builtin'))
  assert.deepEqual(PRESET_IDS, PALETTE_PRESETS.map(p => p.id))
  // Skin / Catppuccin ids are NOT part of the public catalog.
  const publicIds = new Set(PRESET_IDS)
  for (const asset of [...SKIN_PRESET_ASSETS, ...CATPPUCCIN_PRESET_ASSETS]) {
    assert.ok(!publicIds.has(asset.id), `${asset.id} must not be publicly selectable`)
  }
})

test('public preset ids are unique and exclude the reserved built-in look', () => {
  const ids = PALETTE_PRESETS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(!ids.includes(''))
})

test('every public preset has valid per-scheme seeds and a matching accent', () => {
  for (const p of PALETTE_PRESETS) {
    assert.ok(validSeeds(p.light), `${p.id}: bad light seeds`)
    assert.ok(validSeeds(p.dark), `${p.id}: bad dark seeds`)
    assert.ok(HEX.test(p.accent), `${p.id}: bad accent`)
    assert.equal(p.accent, p.light.accent, `${p.id}: accent != light.accent`)
  }
})

test('asset catalogs carry the expected counts', () => {
  assert.equal(SKIN_PRESET_ASSETS.length, 21)
  assert.equal(CATPPUCCIN_PRESET_ASSETS.length, 4)
})

test('asset ids are unique within and across catalogs', () => {
  const ids = [...SKIN_PRESET_ASSETS, ...CATPPUCCIN_PRESET_ASSETS].map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every asset has valid per-scheme seeds and a matching accent', () => {
  for (const p of [...SKIN_PRESET_ASSETS, ...CATPPUCCIN_PRESET_ASSETS]) {
    assert.ok(validSeeds(p.light), `${p.id}: bad light seeds`)
    assert.ok(validSeeds(p.dark), `${p.id}: bad dark seeds`)
    assert.ok(HEX.test(p.accent), `${p.id}: bad accent`)
    assert.equal(p.accent, p.light.accent, `${p.id}: accent != light.accent`)
  }
})

test('a single-scheme asset keeps its declared scheme; the opposite is derived', () => {
  for (const p of [...SKIN_PRESET_ASSETS, ...CATPPUCCIN_PRESET_ASSETS]) {
    assert.ok(p.appearance === 'light' || p.appearance === 'dark', `${p.id}: missing appearance`)
    const declared = p.appearance === 'light' ? p.light : p.dark
    const opposite = p.appearance === 'light' ? p.dark : p.light
    // Declared scheme: voice colors AND surface/text come from the source.
    assert.equal(declared.accent, p.accent)
    // Opposite scheme: same voice colors, neutral surface/text.
    assert.equal(opposite.accent, p.accent)
    assert.equal(opposite.secondary, declared.secondary)
    assert.notEqual(opposite.surface, declared.surface)
  }
})

test('derived opposite schemes are high-contrast neutrals', () => {
  const byId = new Map<string, PalettePreset>([...SKIN_PRESET_ASSETS, ...CATPPUCCIN_PRESET_ASSETS].map(p => [p.id, p]))
  const miku = byId.get('miku')!
  assert.equal(miku.appearance, 'light')
  assert.ok(Number.parseInt(miku.dark.surface.slice(1), 16) < 0x404040, 'dark variant surface should be dark')
  const dalao = byId.get('dalao')!
  assert.equal(dalao.appearance, 'dark')
  assert.ok(Number.parseInt(dalao.light.surface.slice(1), 16) > 0xc0c0c0, 'light variant surface should be light')
})
