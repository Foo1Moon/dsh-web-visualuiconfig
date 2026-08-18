/**
 * Host store tests: file round-trip, sanitize-on-load, corrupt-file backup,
 * revision monotonicity, and serialized concurrent writes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, sanitizeConfig } from '../../src/shared/config.ts'
import { CONFIG_FILENAME, PersonalizationStore } from '../../src/host/store.ts'

/** A scratch dsh home per test. */
async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'personal-store-'))
}

test('fresh store has defaults and no file', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    const snapshot = await store.getSnapshot()
    assert.equal(snapshot.written, false)
    assert.equal(snapshot.revision, 0)
    assert.deepEqual(snapshot.config, DEFAULT_CONFIG)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('update persists, bumps revision, and sanitizes the document', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    const first = await store.update({ enabled: false, junk: 'ignored' })
    assert.equal(first.written, true)
    assert.equal(first.revision, 1)
    assert.equal(first.config.enabled, false)
    // Unknown fields are stripped.
    assert.equal('junk' in first.config, false)

    const second = await store.update(first.config)
    assert.equal(second.revision, 2)

    // The file exists on disk with the expected shape.
    const raw = JSON.parse(await readFile(join(home, CONFIG_FILENAME), 'utf8')) as Record<string, unknown>
    assert.equal(raw.revision, 2)
    assert.equal(raw.schemaVersion, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a fresh store reads the persisted document back', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    await store.update({ enabled: false })
    const reloaded = new PersonalizationStore(home)
    const snapshot = await reloaded.getSnapshot()
    assert.equal(snapshot.written, true)
    assert.equal(snapshot.revision, 1)
    assert.equal(snapshot.config.enabled, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a corrupt file is backed up and the store falls back to defaults', async () => {
  const home = await tempHome()
  try {
    await writeFile(join(home, CONFIG_FILENAME), '{ this is not json', 'utf8')
    const store = new PersonalizationStore(home)
    const snapshot = await store.getSnapshot()
    assert.equal(snapshot.written, false)
    assert.equal(snapshot.revision, 0)
    assert.deepEqual(snapshot.config, DEFAULT_CONFIG)
    // The corrupt file was preserved under a backup name.
    const files = await readdir(home)
    assert.ok(files.some(name => name.startsWith(`${CONFIG_FILENAME}.corrupt-`)), 'corrupt backup exists')
    assert.ok(!files.includes(CONFIG_FILENAME), 'original file renamed away')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('concurrent updates serialize: every write lands, revisions are monotonic', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    const writes = Array.from({ length: 20 }, (_, i) => store.update({ enabled: i % 2 === 0 }))
    const results = await Promise.all(writes)
    const revisions = results.map(r => r.revision)
    assert.deepEqual(revisions, Array.from({ length: 20 }, (_, i) => i + 1))
    const snapshot = await store.getSnapshot()
    assert.equal(snapshot.revision, 20)
    // The serialized chain always lands the last writer's content.
    assert.equal(snapshot.config.enabled, (20 - 1) % 2 === 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('reset restores defaults and bumps the revision', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    await store.update({ enabled: false })
    const reset = await store.reset()
    assert.equal(reset.revision, 2)
    assert.deepEqual(reset.config, sanitizeConfig(DEFAULT_CONFIG))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('uninstall removes the config file and resets in-memory state', async () => {
  const home = await tempHome()
  try {
    const store = new PersonalizationStore(home)
    await store.update({ enabled: false })
    await store.uninstall()
    const snapshot = await store.getSnapshot()
    assert.equal(snapshot.written, false)
    assert.equal(snapshot.revision, 0)
    await assert.rejects(readFile(join(home, CONFIG_FILENAME)))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
