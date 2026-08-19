/**
 * Host HTTP surface: every `/personalization/*` route the browser half (and,
 * later, agents) talks to. One prefix route is registered on the webServer
 * service and dispatched here — config GET/PUT, reset, asset upload/serve,
 * the SSE revision channel, and the explicit uninstall cleanup.
 *
 * Security posture: same-origin only (the web server binds loopback), JSON
 * bodies are size-limited and re-sanitized on the host, asset uploads are
 * MIME-whitelisted and size-limited, and asset file names are strictly
 * validated before any disk access.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { PersonalizationConfig } from '../shared/config.ts'
import { PANEL_IDS, parseAssetRef } from '../shared/config.ts'
import type { AssetStore } from './assets.ts'
import { ASSET_EXT_MIME, parseAssetFilename } from './assets.ts'
import { appendDiagnostics } from './diagnostics.ts'
import type { PersonalizationStore } from './store.ts'

/** Config JSON body limit. */
export const MAX_CONFIG_BODY_BYTES = 1024 * 1024
/** Asset upload body limit. */
export const MAX_ASSET_BODY_BYTES = 10 * 1024 * 1024
/** Diagnostics report body limit. */
export const MAX_DIAGNOSTICS_BODY_BYTES = 256 * 1024

/** An HTTP-level error mapped to a status code by the dispatcher. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Collect every `asset:` hash the config references (the GC keep-set).
 *  Exported for the `/personalization` command and any other GC caller. */
export function collectAssetHashes(config: PersonalizationConfig): Set<string> {
  const hashes = new Set<string>()
  const add = (image: string | null | undefined): void => {
    if (typeof image !== 'string') return
    const ref = parseAssetRef(image)
    if (ref !== null) hashes.add(ref.hash)
  }
  add(config.globalBackground.image)
  add(config.chrome.favicon)
  add(config.base.background.image)
  for (const id of PANEL_IDS) add(config.panels[id].background.image)
  // The theme library: source art plus every image ref inside a theme's patch
  // or snapshot — an inactive saved theme must survive the GC.
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('asset:')) {
        const ref = parseAssetRef(value)
        if (ref !== null) hashes.add(ref.hash)
      }
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) scan(v)
    }
  }
  scan(config.themes)
  return hashes
}

/** Accumulate a request body, failing with 413 once it exceeds `maxBytes`. */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new HttpError(413, 'request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/** Read and JSON-parse a request body. */
async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const body = await readBody(req, maxBytes)
  if (body.length === 0) throw new HttpError(400, 'empty request body')
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body is not valid JSON')
  }
}

/** Send a JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** The router's public face. */
export interface PersonalizationRouter {
  /** Dispatch one request (the registered prefix handler). */
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  /** Close SSE connections and stop observing the store. */
  dispose: () => void
}

/**
 * Create the personalization HTTP surface over a store and asset store.
 * @param store - the configuration store.
 * @param assets - the image asset store.
 * @returns the router.
 */
export function createPersonalizationRouter(
  store: PersonalizationStore,
  assets: AssetStore,
): PersonalizationRouter {
  const connections = new Set<ServerResponse>()

  const broadcast = (revision: number): void => {
    const frame = `data: ${JSON.stringify({ revision })}\n\n`
    for (const res of connections) res.write(frame)
  }
  const offStore = store.subscribe(broadcast)

  const connectSse = (res: ServerResponse): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    })
    res.write(': connected\n\n')
    // The initial revision lets a late subscriber catch up immediately.
    void store.getSnapshot().then(snapshot => {
      if (res.writableEnded || res.destroyed) return
      res.write(`data: ${JSON.stringify({ revision: snapshot.revision })}\n\n`)
    })
    connections.add(res)
    res.on('close', () => {
      connections.delete(res)
    })
  }

  /** GC the asset directory against a freshly written config. */
  const gcAfter = (config: PersonalizationConfig): Promise<string[]> =>
    assets.gc(collectAssetHashes(config))

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://personalization').pathname
      const method = req.method ?? 'GET'

      // --- config ---------------------------------------------------------
      if (pathname === '/personalization/config') {
        if (method === 'GET') {
          const snapshot = await store.getSnapshot()
          if (!snapshot.written) {
            res.writeHead(404)
            res.end()
            return
          }
          sendJson(res, 200, { revision: snapshot.revision, config: snapshot.config })
          return
        }
        if (method === 'PUT') {
          const input = await readJsonBody(req, MAX_CONFIG_BODY_BYTES)
          if (typeof input !== 'object' || input === null) throw new HttpError(400, 'config body must be an object')
          const snapshot = await store.update(input)
          await gcAfter(snapshot.config)
          sendJson(res, 200, { revision: snapshot.revision, config: snapshot.config })
          return
        }
        if (method === 'PATCH') {
          // Partial update: deep-merged into the current document (the
          // programmatic/agent-friendly path — no need to send the whole doc).
          const input = await readJsonBody(req, MAX_CONFIG_BODY_BYTES)
          if (typeof input !== 'object' || input === null) throw new HttpError(400, 'patch body must be an object')
          const snapshot = await store.patch(input)
          await gcAfter(snapshot.config)
          sendJson(res, 200, { revision: snapshot.revision, config: snapshot.config })
          return
        }
        throw new HttpError(405, 'method not allowed')
      }

      // --- reset ----------------------------------------------------------
      if (pathname === '/personalization/reset') {
        if (method !== 'POST') throw new HttpError(405, 'method not allowed')
        const snapshot = await store.reset()
        await gcAfter(snapshot.config)
        sendJson(res, 200, { revision: snapshot.revision })
        return
      }

      // --- uninstall cleanup ----------------------------------------------
      if (pathname === '/personalization/uninstall') {
        if (method !== 'POST') throw new HttpError(405, 'method not allowed')
        await store.uninstall()
        sendJson(res, 200, { ok: true })
        return
      }

      // --- diagnostics ------------------------------------------------------
      // The browser engine reports every applied config + emitted CSS + live
      // layout measurements here (throttled client-side), so a reproduced
      // layout bug can be diagnosed from ~/.dsh/personalization-diagnostics.jsonl.
      if (pathname === '/personalization/diagnostics') {
        if (method !== 'POST') throw new HttpError(405, 'method not allowed')
        const input = await readJsonBody(req, MAX_DIAGNOSTICS_BODY_BYTES)
        if (typeof input !== 'object' || input === null) throw new HttpError(400, 'diagnostics body must be an object')
        await appendDiagnostics(dirname(store.filePath), input)
        sendJson(res, 200, { ok: true })
        return
      }

      // --- SSE revision channel --------------------------------------------
      if (pathname === '/personalization/events') {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed')
        if (method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end()
          return
        }
        connectSse(res)
        return
      }

      // --- assets ----------------------------------------------------------
      if (pathname.startsWith('/personalization/assets')) {
        await handleAsset(req, res, pathname, assets)
        return
      }

      throw new HttpError(404, 'not found')
    } catch (error) {
      if (error instanceof HttpError) {
        res.writeHead(error.status)
        res.end()
        return
      }
      throw error
    }
  }

  return {
    handle,
    dispose: () => {
      offStore()
      for (const res of connections) res.destroy()
      connections.clear()
    },
  }
}

/** Asset sub-routes: upload (PUT) and serve (GET). */
async function handleAsset(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  assets: AssetStore,
): Promise<void> {
  const method = req.method ?? 'GET'

  if (pathname === '/personalization/assets') {
    // The bare path is the upload endpoint; any other method is a 405.
    if (method !== 'PUT') throw new HttpError(405, 'method not allowed')
    const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
    if (mime === '') throw new HttpError(415, 'missing content type')
    const bytes = await readBody(req, MAX_ASSET_BODY_BYTES)
    if (bytes.length === 0) throw new HttpError(400, 'empty asset body')
    try {
      const stored = await assets.save(bytes, mime)
      sendJson(res, 200, { id: stored.id, url: stored.url })
    } catch (error) {
      // AssetStore rejects unknown MIME types with a status-carrying error.
      const status = (error as { status?: unknown }).status
      if (typeof status === 'number') {
        res.writeHead(status)
        res.end()
        return
      }
      throw error
    }
    return
  }

  const name = pathname.slice('/personalization/assets/'.length)
  if (name === '' || name.includes('/') || parseAssetFilename(name) === null) {
    throw new HttpError(404, 'not found')
  }

  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed')
  const asset = await assets.read(name)
  if (asset === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const ext = asset.ext
  const type = ASSET_EXT_MIME[ext] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'content-length': asset.bytes.length,
    'cache-control': 'public, max-age=31536000, immutable',
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(asset.bytes)
}
