/**
 * Host-side image asset storage: background/favicon images are stored as
 * files under `~/.dsh/personalization/<sha256>.<ext>` and served over the
 * webServer route, so the browser config document stays small (no data URLs)
 * and escapes the localStorage quota and the 2MB CSS `url()` limit entirely.
 *
 * File names are content-addressed (sha256) and strictly validated — nothing
 * outside the fixed asset directory can ever be read or deleted through this
 * module. `gc` removes files whose hash is no longer referenced by the config.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './store.ts'

/** Accepted upload MIME types → file extension. */
export const ASSET_MIME_EXT: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
})

/** Accepted file extensions → content type (for GET responses). */
export const ASSET_EXT_MIME: Readonly<Record<string, string>> = Object.freeze({
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
  'gif': 'image/gif',
})

/** One stored asset's identity. */
export interface StoredAsset {
  /** Config-facing id: `asset:<sha256>.<ext>`. */
  id: string
  /** Host-served URL path. */
  url: string
}

/** Validate an asset file name (`<sha256>.<ext>`), returning the hash. */
export function parseAssetFilename(name: string): string | null {
  const match = /^([0-9a-f]{64})\.(jpg|png|webp|gif)$/.exec(name)
  const hash = match?.[1]
  return hash === undefined ? null : hash
}

/**
 * The asset file store. All operations target the fixed directory given at
 * construction; every file name is validated before touching the disk.
 */
export class AssetStore {
  constructor(readonly dir: string) {}

  /** Store raw image bytes; returns the asset id and URL. Rejects unknown MIME types. */
  async save(bytes: Uint8Array, mime: string): Promise<StoredAsset> {
    const ext = ASSET_MIME_EXT[mime]
    if (ext === undefined) {
      throw Object.assign(new Error(`unsupported asset content type: ${mime}`), { status: 415 })
    }
    const hash = createHash('sha256').update(bytes).digest('hex')
    await writeFileAtomic(join(this.dir, `${hash}.${ext}`), bytes)
    return { id: `asset:${hash}.${ext}`, url: `/personalization/assets/${hash}.${ext}` }
  }

  /** Read a stored asset by validated file name; null when missing. */
  async read(name: string): Promise<{ bytes: Buffer; ext: string } | null> {
    if (parseAssetFilename(name) === null) return null
    try {
      const bytes = await readFile(join(this.dir, name))
      const ext = name.slice(name.lastIndexOf('.') + 1)
      return { bytes, ext }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /** All asset file names currently stored. */
  async list(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter(name => parseAssetFilename(name) !== null)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /** Delete every stored file whose hash is not in `referencedHashes`. */
  async gc(referencedHashes: ReadonlySet<string>): Promise<string[]> {
    const removed: string[] = []
    for (const name of await this.list()) {
      const hash = parseAssetFilename(name)
      if (hash === null || referencedHashes.has(hash)) continue
      try {
        await unlink(join(this.dir, name))
        removed.push(name)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return removed
  }
}
