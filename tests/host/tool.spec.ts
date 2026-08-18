/**
 * `personalization` tool tests: argument validation and the execute path
 * (including the local-image background flow) against a temp store.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../../src/host/assets.ts'
import { createPersonalizationToolDefinition, validateToolArgs } from '../../src/host/tool.ts'
import { PersonalizationStore } from '../../src/host/store.ts'

async function tempEnv(): Promise<{ home: string; store: PersonalizationStore; assets: AssetStore }> {
  const home = await mkdtemp(join(tmpdir(), 'personal-tool-'))
  const store = new PersonalizationStore(home)
  return { home, store, assets: new AssetStore(store.assetsDir) }
}

test('validateToolArgs normalizes valid values', () => {
  assert.deepEqual(validateToolArgs({ accent: '#FF8800' }), { accent: '#ff8800' })
  assert.deepEqual(validateToolArgs({ accent: 'ff8800' }), { accent: '#ff8800' })
  assert.deepEqual(validateToolArgs({ preset: 'ocean' }), { preset: 'ocean' })
  assert.deepEqual(validateToolArgs({ transparency: 0.5 }), { transparency: 0.5 })
  assert.deepEqual(validateToolArgs({ font: 'mono' }), { font: 'mono' })
  assert.deepEqual(validateToolArgs({ storage: 'browser' }), { storage: 'browser' })
  assert.deepEqual(validateToolArgs({ enabled: false }), { enabled: false })
})

test('validateToolArgs rejects bad values with descriptive errors', () => {
  assert.throws(() => validateToolArgs({ accent: 'red' }), /hex/)
  assert.throws(() => validateToolArgs({ preset: 'foo' }), /preset/)
  assert.throws(() => validateToolArgs({ transparency: 1.5 }), /transparency/)
  assert.throws(() => validateToolArgs({ transparency: '0.5' }), /transparency/)
  assert.throws(() => validateToolArgs({ font: 'comic' }), /font/)
  assert.throws(() => validateToolArgs({ storage: 'cloud' }), /storage/)
  assert.throws(() => validateToolArgs({ backgroundImage: '' }), /path/)
  assert.throws(() => validateToolArgs('nope'), /object/)
})

test('execute applies a combined patch and confirms with the revision', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createPersonalizationToolDefinition(store, assets)
    const result = await tool.execute({ accent: '#ff8800', transparency: 0.4, font: 'serif' }, { signal: new AbortController().signal })
    assert.deepEqual(result, { message: 'Personalization updated (revision 1).', revision: 1 })
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.palette.accent, '#ff8800')
    assert.equal(config.base.glass.opacity, 0.4)
    assert.equal(config.base.font.family, 'serif')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute with no args reports the current state', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createPersonalizationToolDefinition(store, assets)
    const result = await tool.execute({}, { signal: new AbortController().signal })
    const snapshot = await store.getSnapshot()
    assert.equal(result.revision, snapshot.revision)
    assert.ok(String(result.message).includes('Personalization'))
    assert.equal(snapshot.revision, 0) // show never writes
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute stores a local background image as an asset', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const imagePath = join(home, 'wall.png')
    await writeFile(imagePath, Buffer.from('fake-png'))
    const tool = createPersonalizationToolDefinition(store, assets)
    const result = await tool.execute({ backgroundImage: imagePath }, { signal: new AbortController().signal })
    assert.equal(result.revision, 1)
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.background.mode, 'image')
    assert.match(config.base.background.image ?? '', /^asset:[0-9a-f]{64}\.png$/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute throws descriptive errors for a missing file and unsupported type', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createPersonalizationToolDefinition(store, assets)
    await assert.rejects(
      tool.execute({ backgroundImage: join(home, 'nope.png') }, { signal: new AbortController().signal }),
      /cannot read/,
    )
    await assert.rejects(
      tool.execute({ backgroundImage: join(home, 'evil.exe') }, { signal: new AbortController().signal }),
      /unsupported/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute reset restores defaults', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const tool = createPersonalizationToolDefinition(store, assets)
    await tool.execute({ accent: '#123456' }, { signal: new AbortController().signal })
    const result = await tool.execute({ reset: true }, { signal: new AbortController().signal })
    assert.ok(String(result.message).includes('reset'))
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.palette.accent, null)
    assert.equal(config.base.glass.opacity, 0.55)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('execute removeBackground switches back to solid', async () => {
  const { home, store, assets } = await tempEnv()
  try {
    const imagePath = join(home, 'wall.jpg')
    await writeFile(imagePath, Buffer.from('fake-jpg'))
    const tool = createPersonalizationToolDefinition(store, assets)
    await tool.execute({ backgroundImage: imagePath }, { signal: new AbortController().signal })
    await tool.execute({ removeBackground: true }, { signal: new AbortController().signal })
    const config = (await store.getSnapshot()).config
    assert.equal(config.base.background.mode, 'solid')
    assert.equal(config.base.background.image, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
