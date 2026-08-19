/**
 * Character-theme tool tests: argument validation, the apply flow (including
 * the local-art asset path and the theme library round-trip), the manage flow
 * (list/switch/deactivate/remove), and asset GC across theme lifecycle.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../../src/host/assets.ts'
import {
  createCharacterThemeManageToolDefinition,
  createCharacterThemeToolDefinition,
  validateCharacterThemeArgs,
  validateManageArgs,
} from '../../src/host/character-tool.ts'
import { PersonalizationStore } from '../../src/host/store.ts'
import { themeIdFromName } from '../../src/shared/config.ts'
import { findTheme } from '../../src/shared/theme.ts'

async function tempEnv(): Promise<{ home: string; store: PersonalizationStore; assets: AssetStore }> {
  const home = await mkdtemp(join(tmpdir(), 'character-tool-'))
  const store = new PersonalizationStore(home)
  return { home, store, assets: new AssetStore(store.assetsDir) }
}

const signal = new AbortController().signal

test('validateCharacterThemeArgs normalizes valid values', () => {
  assert.deepEqual(validateCharacterThemeArgs({ name: ' Asuna ', accent: '#FF6B9D' }), {
    name: 'Asuna',
    accent: '#ff6b9d',
  })
  assert.deepEqual(validateCharacterThemeArgs({ preset: 'ocean', font: 'mono', transparency: 0.5 }), {
    preset: 'ocean',
    font: 'mono',
    transparency: 0.5,
  })
  assert.deepEqual(validateCharacterThemeArgs({ name: 'Rei', background: true, scrim: 0.6, favicon: true, title: 'Rei' }), {
    name: 'Rei',
    background: true,
    scrim: 0.6,
    favicon: true,
    title: 'Rei',
  })
})

test('validateCharacterThemeArgs rejects bad values with descriptive errors', () => {
  assert.throws(() => validateCharacterThemeArgs({ name: ' ' }), /name/)
  assert.throws(() => validateCharacterThemeArgs({ accent: 'pink' }), /hex/)
  assert.throws(() => validateCharacterThemeArgs({ preset: 'foo' }), /preset/)
  assert.throws(() => validateCharacterThemeArgs({ font: 'comic' }), /font/)
  assert.throws(() => validateCharacterThemeArgs({ transparency: 1.2 }), /transparency/)
  assert.throws(() => validateCharacterThemeArgs({ scrim: 2 }), /scrim/)
  assert.throws(() => validateCharacterThemeArgs({ background: 'yes' }), /boolean/)
  assert.throws(() => validateCharacterThemeArgs({ title: '' }), /title/)
  assert.throws(() => validateCharacterThemeArgs({ seeds: { accent: '#ff6b9d' } }), /seeds/)
  assert.throws(() => validateCharacterThemeArgs({ seeds: { accent: 'pink', secondary: '#000000', surface: '#ffffff', text: '#000000' } }), /seeds/)
  assert.throws(() => validateCharacterThemeArgs({ appearance: 'sepia' }), /appearance/)
  assert.throws(() => validateCharacterThemeArgs('nope'), /object/)
})

test('validateCharacterThemeArgs normalizes seeds and appearance', () => {
  assert.deepEqual(validateCharacterThemeArgs({
    name: 'Asuna',
    seeds: { accent: '#FF6B9D', secondary: '#8C5A1A', surface: '#F4F1EA', text: '#241F1A' },
    appearance: 'dark',
  }), {
    name: 'Asuna',
    seeds: { accent: '#ff6b9d', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
    appearance: 'dark',
  })
})

test('validateManageArgs defaults to list and requires a name for switch/remove', () => {
  assert.deepEqual(validateManageArgs({}), { action: 'list' })
  assert.deepEqual(validateManageArgs({ action: 'switch', name: 'Asuna' }), { action: 'switch', name: 'Asuna' })
  assert.throws(() => validateManageArgs({ action: 'switch' }), /name/)
  assert.throws(() => validateManageArgs({ action: 'remove' }), /name/)
  assert.throws(() => validateManageArgs({ action: 'rename' }), /action/)
})

test('execute applies a theme: asset stored, config overlaid, library populated', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const artPath = join(home, 'asuna.png')
    await writeFile(artPath, Buffer.from('fake-png'))
    const tool = createCharacterThemeToolDefinition(store, assets)
    const result = await tool.execute({
      name: 'Asuna',
      description: '勇敢的副团长',
      imagePath: artPath,
      accent: '#ff6b9d',
      font: 'rounded',
      transparency: 0.6,
      background: true,
      scrim: 0.5,
      favicon: true,
      title: 'Asuna',
    }, { signal })
    assert.equal(result.revision, 1)
    assert.match(String(result.message), /"Asuna" applied/)

    const config = (await store.getSnapshot()).config
    assert.equal(config.themes.active, themeIdFromName('Asuna'))
    assert.equal(config.themes.list.length, 1)
    assert.equal(config.themes.list[0]?.description, '勇敢的副团长')
    assert.match(config.themes.list[0]?.sourceImage ?? '', /^asset:[0-9a-f]{64}\.png$/)
    assert.equal(config.base.palette.accent, '#ff6b9d')
    assert.equal(config.base.font.family, 'rounded')
    assert.equal(config.base.glass.opacity, 0.6)
    assert.equal(config.globalBackground.image, config.themes.list[0]?.sourceImage)
    assert.equal(config.globalBackground.scrim, 0.5)
    assert.equal(config.chrome.favicon, config.themes.list[0]?.sourceImage)
    assert.equal(config.chrome.title, 'Asuna')

    // The art asset is referenced by the library, so it survives the GC.
    const files = await readdir(assets.dir)
    assert.equal(files.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute applies a seeds theme: base palette carries seeds + pinned scheme', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createCharacterThemeToolDefinition(store, assets)
    const seeds = { accent: '#1a8a92', secondary: '#4fb3b8', surface: '#ffffff', text: '#16202b' }
    const result = await tool.execute({ name: 'Asuna', seeds, appearance: 'dark', font: 'serif' }, { signal })
    assert.equal(result.revision, 1)
    const config = (await store.getSnapshot()).config
    assert.deepEqual(config.base.palette, { preset: '', accent: null, seeds, appearance: 'dark' })
    assert.equal(config.base.font.family, 'serif')
    // Theme-level fields mirror the seeds for tooling/UI display.
    assert.deepEqual(config.themes.list[0]?.seeds, seeds)
    assert.equal(config.themes.list[0]?.appearance, 'dark')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute re-applying the same name replaces the theme in place', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createCharacterThemeToolDefinition(store, assets)
    await tool.execute({ name: 'Asuna', accent: '#ff6b9d' }, { signal })
    const result = await tool.execute({ name: 'Asuna', preset: 'violet', font: 'serif' }, { signal })
    const config = (await store.getSnapshot()).config
    assert.equal(config.themes.list.length, 1)
    assert.equal(config.themes.active, themeIdFromName('Asuna'))
    assert.equal(config.base.palette.accent, null)
    assert.equal(config.base.palette.preset, 'violet')
    assert.equal(config.base.font.family, 'serif')
    assert.equal(result.revision, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute throws when there is nothing to decide or background lacks an image', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createCharacterThemeToolDefinition(store, assets)
    await assert.rejects(tool.execute({ name: 'Asuna' }, { signal }), /image.*or.*decision|decision/i)
    await assert.rejects(tool.execute({ name: 'Asuna', background: true }, { signal }), /imagePath/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('manage: list → switch → deactivate → remove round-trip', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const apply = createCharacterThemeToolDefinition(store, assets)
    const manage = createCharacterThemeManageToolDefinition(store, assets)
    await apply.execute({ name: 'Asuna', accent: '#ff6b9d' }, { signal })
    await apply.execute({ name: 'Rei', preset: 'ocean', font: 'mono' }, { signal })

    // list
    const listed = await manage.execute({ action: 'list' }, { signal })
    const text = String(listed.message)
    assert.match(text, /"Asuna"/)
    assert.match(text, /"Rei"/)
    assert.match(text, /\[active\]/)

    // switch to Rei
    const switched = await manage.execute({ action: 'switch', name: 'Rei' }, { signal })
    assert.match(String(switched.message), /Switched to character theme "Rei"/)
    let config = (await store.getSnapshot()).config
    assert.equal(config.themes.active, themeIdFromName('Rei'))
    assert.equal(config.base.palette.preset, 'ocean')
    assert.equal(config.base.palette.accent, null)

    // deactivate → official look restored, themes stay in the library
    await manage.execute({ action: 'deactivate' }, { signal })
    config = (await store.getSnapshot()).config
    assert.equal(config.themes.active, null)
    assert.equal(config.base.palette.accent, null)
    assert.equal(config.base.palette.preset, '')
    assert.equal(config.themes.list.length, 2)

    // remove the inactive theme; the active one is removed too when named
    const removed = await manage.execute({ action: 'remove', name: 'Asuna' }, { signal })
    assert.match(String(removed.message), /"Asuna" removed/)
    config = (await store.getSnapshot()).config
    assert.equal(config.themes.list.length, 1)
    assert.equal(config.themes.list[0]?.name, 'Rei')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('manage errors on unknown themes and missing names', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const manage = createCharacterThemeManageToolDefinition(store, assets)
    const empty = await manage.execute({ action: 'list' }, { signal })
    assert.match(String(empty.message), /No character themes yet/)
    await assert.rejects(manage.execute({ action: 'switch', name: 'Nobody' }, { signal }), /no character theme/)
    await assert.rejects(manage.execute({ action: 'remove', name: 'Nobody' }, { signal }), /no character theme/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('asset GC keeps an inactive saved theme art and drops it after removal', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const artPath = join(home, 'rei.png')
    await writeFile(artPath, Buffer.from('fake-png'))
    const apply = createCharacterThemeToolDefinition(store, assets)
    const manage = createCharacterThemeManageToolDefinition(store, assets)
    await apply.execute({ name: 'Rei', imagePath: artPath, preset: 'ocean' }, { signal })

    // Apply another theme so Rei becomes inactive — its art must survive.
    await apply.execute({ name: 'Asuna', accent: '#ff6b9d' }, { signal })
    let files = await readdir(assets.dir)
    assert.equal(files.length, 1)
    const kept = findTheme((await store.getSnapshot()).config, 'Rei')
    assert.ok(kept !== undefined && kept.sourceImage !== null)

    // Removing Rei garbage-collects its art.
    await manage.execute({ action: 'remove', name: 'Rei' }, { signal })
    files = await readdir(assets.dir)
    assert.equal(files.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
