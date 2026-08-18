/**
 * Host routes tests: drive the real HTTP surface (config GET/PUT, reset,
 * assets, SSE, uninstall) over a loopback server, including limits and
 * validation failures.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetStore } from '../../src/host/assets.ts'
import { createPersonalizationRouter } from '../../src/host/routes.ts'
import { PersonalizationStore } from '../../src/host/store.ts'

let home: string
let base: string
let server: ReturnType<typeof createServer>
let store: PersonalizationStore
let assets: AssetStore

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'personal-routes-'))
  store = new PersonalizationStore(home)
  assets = new AssetStore(store.assetsDir)
  const router = createPersonalizationRouter(store, assets)
  server = createServer((req, res) => {
    void router.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error))
      } else {
        res.destroy()
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(home, { recursive: true, force: true })
})

test('config GET 404s before anything was written', async () => {
  const res = await fetch(`${base}/personalization/config`, { cache: 'no-store' })
  assert.equal(res.status, 404)
})

test('config PUT persists a sanitized document and echoes the revision', async () => {
  const res = await fetch(`${base}/personalization/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false, junk: 'stripped' }),
  })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { revision: number; config: Record<string, unknown> }
  assert.equal(body.revision, 1)
  assert.equal(body.config.enabled, false)
  assert.equal('junk' in body.config, false)
})

test('config GET returns the stored document', async () => {
  const res = await fetch(`${base}/personalization/config`, { cache: 'no-store' })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { revision: number; config: { enabled: boolean } }
  assert.equal(body.revision, 1)
  assert.equal(body.config.enabled, false)
})

test('config PUT rejects invalid JSON with 400 and oversize bodies with 413', async () => {
  let res = await fetch(`${base}/personalization/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  })
  assert.equal(res.status, 400)

  res = await fetch(`${base}/personalization/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1) }),
  })
  assert.equal(res.status, 413)
})

test('config PATCH deep-merges a partial update', async () => {
  const res = await fetch(`${base}/personalization/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, junk: 'stripped' }),
  })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { revision: number; config: Record<string, unknown> }
  // The earlier PUT stored enabled=false at revision 1; the patch merges over it.
  assert.equal(body.revision, 2)
  assert.equal(body.config.enabled, true)
  assert.equal('junk' in body.config, false)

  const bad = await fetch(`${base}/personalization/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{ nope',
  })
  assert.equal(bad.status, 400)
})

test('reset restores defaults and clears the asset store', async () => {
  const upload = await fetch(`${base}/personalization/assets`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('reset-me'),
  })
  assert.equal(upload.status, 200)
  const uploaded = (await upload.json()) as { id: string }
  assert.ok(uploaded.id.startsWith('asset:'))

  const res = await fetch(`${base}/personalization/reset`, { method: 'POST' })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { revision: number }
  // PUT (1) then PATCH (2); reset bumps it to 3.
  assert.equal(body.revision, 3)
  // Default config references nothing → the asset store is emptied.
  const files = await readdir(join(home, 'personalization'))
  assert.deepEqual(files, [])
})

test('asset upload accepts whitelisted images and serves them back', async () => {
  const bytes = Buffer.from('hello-asset')
  const upload = await fetch(`${base}/personalization/assets`, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: bytes,
  })
  assert.equal(upload.status, 200)
  const body = (await upload.json()) as { id: string; url: string }
  assert.match(body.id, /^asset:[0-9a-f]{64}\.jpg$/)

  const served = await fetch(`${base}${body.url}`, { cache: 'no-store' })
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/jpeg')
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes)
})

test('asset upload rejects unknown content types with 415', async () => {
  const res = await fetch(`${base}/personalization/assets`, {
    method: 'PUT',
    headers: { 'content-type': 'application/zip' },
    body: Buffer.from('zip'),
  })
  assert.equal(res.status, 415)
})

test('asset GET validates the name strictly', async () => {
  let res = await fetch(`${base}/personalization/assets/..%2F..%2Fwindows%2Fwin.ini`, { cache: 'no-store' })
  assert.equal(res.status, 404)
  res = await fetch(`${base}/personalization/assets/${'f'.repeat(64)}.jpg`, { cache: 'no-store' })
  assert.equal(res.status, 404)
})

test('config PUT triggers asset GC: dropped refs are deleted', async () => {
  // Two assets; the config references only the first.
  const a = await (await fetch(`${base}/personalization/assets`, {
    method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from('A'),
  })).json() as { id: string }
  const b = await (await fetch(`${base}/personalization/assets`, {
    method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from('B'),
  })).json() as { id: string }

  const res = await fetch(`${base}/personalization/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ globalBackground: { image: a.id, scrim: 0.3 } }),
  })
  assert.equal(res.status, 200)
  const files = await readdir(join(home, 'personalization'))
  assert.deepEqual(files, [a.id.slice('asset:'.length)])
  void b
})

test('wrong methods and unknown paths fail cleanly', async () => {
  let res = await fetch(`${base}/personalization/config`, { method: 'DELETE' })
  assert.equal(res.status, 405)
  res = await fetch(`${base}/personalization/nope`, { cache: 'no-store' })
  assert.equal(res.status, 404)
  res = await fetch(`${base}/personalization/assets`, { cache: 'no-store' })
  assert.equal(res.status, 405)
})

test('SSE channel broadcasts revision frames', async () => {
  // Open the channel and read the initial frame.
  const res = await fetch(`${base}/personalization/events`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/event-stream')
  const reader = res.body?.getReader()
  assert.ok(reader !== undefined)

  const readFrame = async (): Promise<{ revision: number } | null> => {
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return null
      const text = decoder.decode(value, { stream: true })
      const match = /data: (\{.*\})/.exec(text)
      if (match?.[1] !== undefined) return JSON.parse(match[1]) as { revision: number }
    }
  }

  const initial = await readFrame()
  assert.ok(initial !== null && typeof initial.revision === 'number')

  // A write from the outside must reach the open channel.
  const before = initial.revision
  const put = await fetch(`${base}/personalization/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(put.status, 200)
  const next = await readFrame()
  assert.ok(next !== null)
  assert.equal(next.revision, before + 1)
  await reader.cancel()
})

test('uninstall removes the store file and assets', async () => {
  const res = await fetch(`${base}/personalization/uninstall`, { method: 'POST' })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean }
  assert.equal(body.ok, true)
  // The store now reports empty again.
  const config = await fetch(`${base}/personalization/config`, { cache: 'no-store' })
  assert.equal(config.status, 404)
})
