/**
 * Host asset store tests: save/read round-trip, MIME whitelist, name
 * validation, and reference-counted GC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore, parseAssetFilename } from '../../src/host/assets.ts'

async function tempAssets(): Promise<{ dir: string; assets: AssetStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'personal-assets-'))
  return { dir, assets: new AssetStore(dir) }
}

test('save stores a content-addressed file and returns the asset id', async () => {
  const { dir, assets } = await tempAssets()
  try {
    const bytes = Buffer.from('fake-jpeg-bytes')
    const stored = await assets.save(bytes, 'image/jpeg')
    assert.match(stored.id, /^asset:[0-9a-f]{64}\.jpg$/)
    assert.equal(stored.url, `/personalization/assets/${stored.id.slice('asset:'.length)}`)
    const files = await readdir(dir)
    assert.deepEqual(files, [stored.id.slice('asset:'.length)])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('save rejects unknown MIME types with a 415', async () => {
  const { dir, assets } = await tempAssets()
  try {
    await assert.rejects(
      assets.save(Buffer.from('x'), 'application/octet-stream'),
      (error: unknown) => (error as NodeJS.ErrnoException & { status?: number }).status === 415,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('read round-trips the bytes and content type', async () => {
  const { dir, assets } = await tempAssets()
  try {
    const bytes = Buffer.from('png-bytes-123')
    const stored = await assets.save(bytes, 'image/png')
    const name = stored.id.slice('asset:'.length)
    const asset = await assets.read(name)
    assert.notEqual(asset, null)
    assert.deepEqual(asset?.bytes, bytes)
    assert.equal(asset?.ext, 'png')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('read rejects invalid names and misses with null', async () => {
  const { dir, assets } = await tempAssets()
  try {
    assert.equal(await assets.read('..\\..\\evil.png'), null)
    assert.equal(await assets.read('not-a-hash.png'), null)
    assert.equal(await assets.read(`${'0'.repeat(64)}.jpg`), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('gc removes unreferenced files and keeps referenced ones', async () => {
  const { dir, assets } = await tempAssets()
  try {
    const keep = await assets.save(Buffer.from('keep'), 'image/jpeg')
    const drop = await assets.save(Buffer.from('drop'), 'image/png')
    const keepHash = keep.id.slice('asset:'.length, -4)
    const removed = await assets.gc(new Set([keepHash]))
    assert.deepEqual(removed, [drop.id.slice('asset:'.length)])
    const files = await readdir(dir)
    assert.deepEqual(files, [keep.id.slice('asset:'.length)])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parseAssetFilename validates shape and extracts the hash', () => {
  assert.equal(parseAssetFilename(`${'a'.repeat(64)}.jpg`), 'a'.repeat(64))
  assert.equal(parseAssetFilename(`${'a'.repeat(63)}.jpg`), null)
  assert.equal(parseAssetFilename(`${'a'.repeat(64)}.exe`), null)
  assert.equal(parseAssetFilename(`${'a'.repeat(64)}.jpg/evil`), null)
})
