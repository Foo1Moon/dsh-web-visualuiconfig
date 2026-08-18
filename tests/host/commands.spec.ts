/**
 * `/personalization` command tests: grammar parsing (pure) and the runner
 * against a temp store + asset store (including the local-file background
 * path).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../../src/host/assets.ts'
import {
  normalizeHex, parsePersonalizationInput, runPersonalizationCommand,
  type PersonalizationAction,
} from '../../src/host/commands.ts'
import { PersonalizationStore } from '../../src/host/store.ts'

async function tempEnv(): Promise<{ home: string; store: PersonalizationStore; assets: AssetStore }> {
  const home = await mkdtemp(join(tmpdir(), 'personal-cmd-'))
  const store = new PersonalizationStore(home)
  return { home, store, assets: new AssetStore(store.assetsDir) }
}

function kindOf(action: PersonalizationAction): string {
  return action.kind
}

test('normalizeHex accepts and normalizes hex colors', () => {
  assert.equal(normalizeHex('#FF8800'), '#ff8800')
  assert.equal(normalizeHex('ff8800'), '#ff8800')
  assert.equal(normalizeHex('red'), null)
  assert.equal(normalizeHex('#fff'), null)
})

test('parsePersonalizationInput covers the grammar', () => {
  assert.equal(kindOf(parsePersonalizationInput('')), 'show')
  assert.equal(kindOf(parsePersonalizationInput('show')), 'show')
  assert.equal(kindOf(parsePersonalizationInput('reset')), 'reset')
  assert.deepEqual(parsePersonalizationInput('set accent #FF8800'), { kind: 'set-accent', accent: '#ff8800' })
  assert.deepEqual(parsePersonalizationInput('set preset ocean'), { kind: 'set-preset', preset: 'ocean' })
  assert.deepEqual(parsePersonalizationInput('set glass 0.5'), { kind: 'set-glass', opacity: 0.5 })
  assert.deepEqual(parsePersonalizationInput('set font mono'), { kind: 'set-font', family: 'mono' })
  assert.deepEqual(parsePersonalizationInput('set storage browser'), { kind: 'set-storage', mode: 'browser' })
  assert.deepEqual(parsePersonalizationInput('background set C:\\img\\wall.png'), { kind: 'background-set', path: 'C:\\img\\wall.png' })
  assert.equal(kindOf(parsePersonalizationInput('background remove')), 'background-remove')
})

test('parsePersonalizationInput rejects bad values with reasons', () => {
  assert.equal(kindOf(parsePersonalizationInput('set accent red')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('set preset foo')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('set glass 1.5')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('set font mono2')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('set storage cloud')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('background set')), 'invalid')
  assert.equal(kindOf(parsePersonalizationInput('frobnicate')), 'invalid')
})

test('run: show renders a summary', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const result = await runPersonalizationCommand('show', store, assets)
    assert.equal(result.kind, 'success')
    if (result.kind === 'success') {
      assert.ok(result.text?.includes('Personalization'))
      assert.ok(result.text?.includes('accent'))
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('run: set accent / preset / glass / font / storage persist via patch', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const accent = await runPersonalizationCommand('set accent #ff8800', store, assets)
    assert.equal(accent.kind, 'success')
    assert.equal((await store.getSnapshot()).config.base.palette.accent, '#ff8800')

    const preset = await runPersonalizationCommand('set preset ocean', store, assets)
    assert.equal(preset.kind, 'success')
    assert.equal((await store.getSnapshot()).config.base.palette.preset, 'ocean')

    await runPersonalizationCommand('set glass 0.4', store, assets)
    assert.equal((await store.getSnapshot()).config.base.glass.opacity, 0.4)

    await runPersonalizationCommand('set font serif', store, assets)
    assert.equal((await store.getSnapshot()).config.base.font.family, 'serif')

    await runPersonalizationCommand('set storage browser', store, assets)
    assert.equal((await store.getSnapshot()).config.storageMode, 'browser')

    await runPersonalizationCommand('set storage host', store, assets)
    assert.equal((await store.getSnapshot()).config.storageMode, 'host')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('run: background set stores a local file as an asset and applies it', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const imagePath = join(home, 'wall.png')
    await writeFile(imagePath, Buffer.from('fake-png'))
    const result = await runPersonalizationCommand(`background set ${imagePath}`, store, assets)
    assert.equal(result.kind, 'success')
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.background.mode, 'image')
    assert.match(config.base.background.image ?? '', /^asset:[0-9a-f]{64}\.png$/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('run: background set rejects missing files and unknown types', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const missing = await runPersonalizationCommand(`background set ${join(home, 'nope.png')}`, store, assets)
    assert.equal(missing.kind, 'error')
    const badType = await runPersonalizationCommand(`background set ${join(home, 'evil.exe')}`, store, assets)
    assert.equal(badType.kind, 'error')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('run: background remove and reset', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const imagePath = join(home, 'wall.jpg')
    await writeFile(imagePath, Buffer.from('fake-jpg'))
    await runPersonalizationCommand(`background set ${imagePath}`, store, assets)

    const removed = await runPersonalizationCommand('background remove', store, assets)
    assert.equal(removed.kind, 'success')
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.background.mode, 'solid')
    assert.equal(config.base.background.image, null)

    const reset = await runPersonalizationCommand('reset', store, assets)
    assert.equal(reset.kind, 'success')
    const after = await store.getSnapshot()
    assert.equal(after.revision > 0, true)
    assert.equal(after.config.base.glass.opacity, 0.55)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('run: invalid input returns an error with usage', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const result = await runPersonalizationCommand('set accent red', store, assets)
    assert.equal(result.kind, 'error')
    if (result.kind === 'error') {
      assert.ok(result.text.includes('Usage:'))
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
