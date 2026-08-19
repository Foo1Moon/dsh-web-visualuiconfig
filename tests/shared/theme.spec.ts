/**
 * Shared character-theme layer tests: patch building, the activate/switch/
 * deactivate/remove semantics (one theme effective at a time, snapshot
 * restore), theme lookup, and the sanitize round-trip.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG, sanitizeConfig, themeIdFromName,
  type CharacterTheme, type PersonalizationConfig,
} from '../../src/shared/config.ts'
import {
  activateTheme, buildThemePatch, deactivateTheme, findTheme, removeTheme,
} from '../../src/shared/theme.ts'

/** A fresh default config (deep-cloned; DEFAULT_CONFIG is frozen). */
function fresh(): PersonalizationConfig {
  return structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
}

/** A minimal theme record for the helpers under test. */
function theme(overrides: Partial<CharacterTheme> & { name: string }): CharacterTheme {
  const name = overrides.name
  return {
    id: themeIdFromName(name),
    name,
    description: '',
    sourceImage: null,
    createdAt: 1,
    patch: {},
    ...overrides,
    id: overrides.id ?? themeIdFromName(name),
  }
}

test('themeIdFromName is deterministic, ASCII-safe and stable across calls', () => {
  assert.equal(themeIdFromName('芙莉莲'), themeIdFromName('芙莉莲'))
  assert.equal(themeIdFromName('Asuna'), themeIdFromName('  Asuna  '))
  assert.match(themeIdFromName('芙莉莲'), /^th-[0-9a-z]+$/)
  assert.notEqual(themeIdFromName('Asuna'), themeIdFromName('Rei'))
})

test('buildThemePatch: accent clears preset and seeds, preset clears accent and seeds', () => {
  assert.deepEqual(buildThemePatch({ accent: '#ff6b9d' }), {
    base: { palette: { accent: '#ff6b9d', preset: '', seeds: null, appearance: null } },
  })
  assert.deepEqual(buildThemePatch({ preset: 'ocean' }), {
    base: { palette: { preset: 'ocean', accent: null, seeds: null, appearance: null } },
  })
  assert.deepEqual(buildThemePatch({ selection: null }), { base: { selection: null } })
})

test('buildThemePatch: seeds replace the fallbacks and carry the pinned scheme', () => {
  const seeds = { accent: '#1a8a92', secondary: '#4fb3b8', surface: '#ffffff', text: '#16202b' }
  assert.deepEqual(buildThemePatch({ seeds, appearance: 'dark' }), {
    base: { palette: { preset: '', accent: null, seeds, appearance: 'dark' } },
  })
  // Explicit null clears a previous theme's seeds.
  assert.deepEqual(buildThemePatch({ seeds: null }), {
    base: { palette: { preset: '', accent: null, seeds: null, appearance: null } },
  })
})

test('buildThemePatch: background/favicon carry the source art; title sets chrome', () => {
  const art = `asset:${'c'.repeat(64)}.png`
  const patch = buildThemePatch({ useBackground: true, scrim: 0.6, useFavicon: true, title: 'Asuna' }, art)
  assert.deepEqual(patch.globalBackground, { image: art, scrim: 0.6 })
  assert.deepEqual(patch.chrome, { favicon: art, title: 'Asuna' })
})

test('activateTheme applies the patch, captures the pre-theme snapshot, sets active', () => {
  const c0 = fresh()
  const t = theme({
    name: 'Asuna',
    patch: buildThemePatch({ accent: '#ff6b9d', font: 'rounded', transparency: 0.6, title: 'Asuna' }),
  })
  const c1 = activateTheme(c0, t)
  assert.equal(c1.themes.active, t.id)
  assert.equal(c1.base.palette.accent, '#ff6b9d')
  assert.equal(c1.base.font.family, 'rounded')
  assert.equal(c1.base.glass.opacity, 0.6)
  assert.equal(c1.chrome.title, 'Asuna')
  assert.equal(c1.themes.list.length, 1)
  assert.deepEqual(c1.themes.list[0]?.snapshot?.base, c0.base)
})

test('switching themes replaces the previous look; deactivating restores the pre-theme state', () => {
  const c0 = fresh()
  const a = theme({ name: 'Asuna', patch: buildThemePatch({ accent: '#ff6b9d', font: 'rounded' }) })
  const b = theme({ name: 'Rei', patch: buildThemePatch({ preset: 'ocean', font: 'mono' }) })

  const c1 = activateTheme(c0, a)
  const c2 = activateTheme(c1, b)
  // B is active; A's look was undone (restored to the pre-A appearance first).
  assert.equal(c2.themes.active, b.id)
  assert.equal(c2.base.palette.accent, null)
  assert.equal(c2.base.palette.preset, 'ocean')
  assert.equal(c2.base.font.family, 'mono')
  assert.deepEqual(c2.themes.list.find(t => t.id === b.id)?.snapshot?.base, c0.base)

  // Switching back to A re-applies A's patch over the restored appearance.
  const c3 = activateTheme(c2, a)
  assert.equal(c3.themes.active, a.id)
  assert.equal(c3.base.palette.accent, '#ff6b9d')
  assert.equal(c3.base.font.family, 'rounded')

  // Deactivating the current theme returns to the exact pre-theme look.
  const c4 = deactivateTheme(c3)
  assert.equal(c4.themes.active, null)
  assert.deepEqual(c4.base, c0.base)
  assert.ok(c4.themes.list.some(t => t.id === a.id))
  assert.ok(c4.themes.list.some(t => t.id === b.id))
})

test('removeTheme deactivates the active theme first and restores its snapshot', () => {
  const c0 = fresh()
  const a = theme({ name: 'Asuna', patch: buildThemePatch({ accent: '#ff6b9d' }) })
  const c1 = activateTheme(c0, a)
  const c2 = removeTheme(c1, a.name)
  assert.equal(c2.themes.active, null)
  assert.equal(c2.themes.list.length, 0)
  assert.deepEqual(c2.base, c0.base)
})

test('removeTheme leaves the config unchanged for an unknown theme', () => {
  const c0 = fresh()
  const c1 = removeTheme(c0, 'Nobody')
  assert.deepEqual(c1, c0)
})

test('findTheme matches by id and by name (trimming the lookup key)', () => {
  const c0 = fresh()
  const a = theme({ name: 'Asuna', patch: buildThemePatch({ accent: '#ff6b9d' }) })
  const c1 = activateTheme(c0, a)
  assert.equal(findTheme(c1, a.id)?.name, 'Asuna')
  assert.equal(findTheme(c1, 'Asuna')?.id, a.id)
  assert.equal(findTheme(c1, '  Asuna  ')?.id, a.id)
  assert.equal(findTheme(c1, 'Nobody'), undefined)
})

test('sanitizeConfig round-trips the theme library and drops a dangling active id', () => {
  const c0 = fresh()
  const a = theme({ name: 'Asuna', patch: buildThemePatch({ accent: '#ff6b9d', title: 'Asuna' }) })
  const c1 = activateTheme(c0, a)
  const sanitized = sanitizeConfig(c1)
  assert.equal(sanitized.themes.active, a.id)
  assert.equal(sanitized.themes.list.length, 1)
  assert.equal(sanitized.themes.list[0]?.patch.base?.palette?.accent, '#ff6b9d')
  assert.equal(sanitized.base.palette.accent, '#ff6b9d')
  assert.equal(sanitized.chrome.title, 'Asuna')

  const dangling = sanitizeConfig({ themes: { active: 'th-gone', list: [c1.themes.list[0]] } })
  assert.equal(dangling.themes.active, null)
  assert.equal(dangling.themes.list.length, 1)
})
