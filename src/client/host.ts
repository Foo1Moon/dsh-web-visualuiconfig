/**
 * Browser → host transport for the personalization surface.
 *
 * Same-origin fetch against the `/personalization/*` routes the host half
 * registers. Every call is defensive about the host half NOT being there yet
 * (the web server's SPA fallback answers unmatched paths with index.html):
 * a non-JSON or non-2xx response is treated as "host unavailable", and the
 * caller degrades to browser-local persistence.
 */

/** The host's config endpoint. */
const CONFIG_PATH = '/personalization/config'
/** The host's asset upload endpoint. */
const ASSET_PATH = '/personalization/assets'

/** Result of fetching the host config. */
export type HostFetchResult =
  /** Host answered with a config document. */
  | { kind: 'ok'; revision: number; config: unknown }
  /** Host is up but no store file exists yet (404). */
  | { kind: 'empty' }
  /** Host unreachable, or answered something unrecognizable (e.g. the SPA fallback). */
  | { kind: 'unavailable' }

/** Parse a JSON response into a revision number, or null. */
function parseRevision(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const revision = (body as Record<string, unknown>).revision
  return typeof revision === 'number' && Number.isFinite(revision) ? revision : null
}

/** Fetch the host config document. */
export async function fetchHostConfig(): Promise<HostFetchResult> {
  try {
    const res = await fetch(CONFIG_PATH, { cache: 'no-store' })
    if (res.status === 404) return { kind: 'empty' }
    if (!res.ok) return { kind: 'unavailable' }
    const body = JSON.parse(await res.text()) as unknown
    if (typeof body !== 'object' || body === null) return { kind: 'unavailable' }
    const record = body as Record<string, unknown>
    if (typeof record.revision !== 'number' || typeof record.config !== 'object' || record.config === null) {
      return { kind: 'unavailable' }
    }
    return { kind: 'ok', revision: record.revision, config: record.config }
  } catch {
    return { kind: 'unavailable' }
  }
}

/** Persist a config document on the host; returns the new revision, or null. */
export async function putHostConfig(config: unknown): Promise<number | null> {
  try {
    const res = await fetch(CONFIG_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return parseRevision(JSON.parse(await res.text()) as unknown)
  } catch {
    return null
  }
}

/** Decode a data URL into a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * Upload a compressed image (data URL) to the host asset store.
 * @returns the `asset:<sha256>.<ext>` id, or null when the host is unavailable
 * or rejects the upload.
 */
export async function uploadAsset(dataUrl: string): Promise<string | null> {
  try {
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg'
    const res = await fetch(ASSET_PATH, {
      method: 'PUT',
      headers: { 'content-type': mime },
      body: dataUrlToBlob(dataUrl),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = JSON.parse(await res.text()) as unknown
    if (typeof body !== 'object' || body === null) return null
    const id = (body as Record<string, unknown>).id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}
