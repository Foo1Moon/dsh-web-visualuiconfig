/**
 * Preset catalog integrity: every palette preset carries valid per-scheme
 * seeds, ids are unique, groups are known, and a single-scheme skin's declared
 * scheme is preserved verbatim (its opposite scheme is the derived variant).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PALETTE_PRESETS, PRESET_IDS, type PalettePreset } from '../../src/shared/presets.ts'

const HEX = /^#[0-9a-f]{6}$/

function validSeeds(seeds: unknown): seeds is { accent: string; secondary: string; surface: string; text: string } {
  if (typeof seeds !== 'object' || seeds === null) return false
  const s = seeds as Record<string, unknown>
  return ['accent', 'secondary', 'surface', 'text'].every(k => typeof s[k] === 'string' && HEX.test(s[k] as string))
}

test('catalog carries the expected groups and counts', () => {
  const groups = new Map<string, number>()
  for (const p of PALETTE_PRESETS) groups.set(p.group, (groups.get(p.group) ?? 0) + 1)
  assert.deepEqual(Object.fromEntries(groups), { builtin: 4, skin: 21, catppuccin: 4 })
})

test('preset ids are unique and PRESET_IDS mirrors the catalog', () => {
  const ids = PALETTE_PRESETS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(PRESET_IDS, ids)
  // The id may not collide with the reserved built-in look.
  assert.ok(!ids.includes(''))
})

test('every preset has valid per-scheme seeds and a matching accent', () => {
  for (const p of PALETTE_PRESETS) {
    assert.ok(validSeeds(p.light), `${p.id}: bad light seeds`)
    assert.ok(validSeeds(p.dark), `${p.id}: bad dark seeds`)
    assert.ok(HEX.test(p.accent), `${p.id}: bad accent`)
    assert.equal(p.accent, p.light.accent, `${p.id}: accent != light.accent`)
  }
})

test('a single-scheme skin keeps its declared scheme; the opposite is derived', () => {
  for (const p of PALETTE_PRESETS) {
    if (p.group === 'builtin') continue
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
  // A light skin's dark variant must be dark-on-dark readable; a dark skin's
  // light variant must be light. Spot-check a few.
  const byId = new Map<string, PalettePreset>(PALETTE_PRESETS.map(p => [p.id, p]))
  const miku = byId.get('miku')!
  assert.equal(miku.appearance, 'light')
  assert.ok(Number.parseInt(miku.dark.surface.slice(1), 16) < 0x404040, 'dark variant surface should be dark')
  const dalao = byId.get('dalao')!
  assert.equal(dalao.appearance, 'dark')
  assert.ok(Number.parseInt(dalao.light.surface.slice(1), 16) > 0xc0c0c0, 'light variant surface should be light')
})
