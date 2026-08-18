/**
 * Partial-update tests: deepMerge semantics and store.patch behavior.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deepMerge } from '../../src/host/patch.ts'
import { PersonalizationStore } from '../../src/host/store.ts'

test('deepMerge merges plain objects recursively and leaves base untouched', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] }
  const merged = deepMerge(base, { a: 2, nested: { y: 3 }, list: [9] })
  assert.deepEqual(merged, { a: 2, nested: { x: 1, y: 3 }, list: [9] })
  // Base is never mutated.
  assert.deepEqual(base, { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] })
})

test('deepMerge skips undefined and replaces with null', () => {
  const base = { a: 1, b: 2, c: { d: 3 } }
  const merged = deepMerge(base, { a: undefined, b: null, c: null })
  assert.deepEqual(merged, { a: 1, b: null, c: null })
})

test('deepMerge ignores non-object patches', () => {
  assert.deepEqual(deepMerge({ a: 1 }, null), { a: 1 })
  assert.deepEqual(deepMerge({ a: 1 }, 'nope'), { a: 1 })
})

test('store.patch merges into the current document and bumps the revision', async () => {
  const home = await mkdtemp(join(tmpdir(), 'personal-patch-'))
  try {
    const store = new PersonalizationStore(home)
    await store.update({ base: { glass: { opacity: 0.3 }, palette: { preset: 'ocean' } } })
    const patched = await store.patch({ base: { palette: { accent: '#ff8800' } } })
    assert.equal(patched.revision, 2)
    // The patch merged into the existing baseline.
    assert.equal(patched.config.base.glass.opacity, 0.3)
    assert.equal(patched.config.base.palette.accent, '#ff8800')
    assert.equal(patched.config.base.palette.preset, 'ocean')
    // Unknown keys are sanitized away.
    assert.equal('junk' in patched.config, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('store.patch replaces scalars with null (clearing) and leaves undefined untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'personal-patch2-'))
  try {
    const store = new PersonalizationStore(home)
    await store.update({ chrome: { favicon: 'data:image/png;base64,QQ==', title: 'Hi' } })
    const cleared = await store.patch({ chrome: { favicon: null, title: undefined } })
    assert.equal(cleared.config.chrome.favicon, null)
    assert.equal(cleared.config.chrome.title, 'Hi')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
