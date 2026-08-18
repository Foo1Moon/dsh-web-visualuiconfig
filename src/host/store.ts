/**
 * Host-side configuration store: the machine-level persistence for the
 * personalization config, living at `~/.dsh/dsh-web-personalization.json`
 * (same convention as dsh-ssh's `~/.dsh/dsh-ssh.json`).
 *
 * Zero external dependencies on purpose: this plugin is installed standalone
 * (link:) and the profile's node_modules does not carry the @deepseek-ai host
 * packages, so everything here uses Node built-ins only — including a small
 * tmp-file + rename atomic writer (the same protocol dsh-atomic-write uses).
 *
 * The store serializes writers through an internal promise chain, keeps the
 * last good value in memory, backs up corrupt files instead of overwriting
 * them, and broadcasts a revision number to SSE subscribers after each write.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PersonalizationConfig } from '../shared/config.ts'
import { DEFAULT_CONFIG, sanitizeConfig } from '../shared/config.ts'
import { deepMerge } from './patch.ts'

/** The store document's schema version (bump on incompatible format changes). */
export const STORE_SCHEMA_VERSION = 1 as const

/** Config file name under the dsh home. */
export const CONFIG_FILENAME = 'dsh-web-personalization.json'

/** Asset directory name under the dsh home. */
export const ASSETS_DIRNAME = 'personalization'

/** Resolve the dsh home: `DSH_HOME`, falling back to `~/.dsh`. */
export function dshHome(): string {
  const env = process.env.DSH_HOME
  return env !== undefined && env.trim() !== '' ? env : join(homedir(), '.dsh')
}

/** Replace `filename` with `content` in one atomic step (tmp sibling + rename).
 *  Exported for the sibling asset store, which persists image bytes the same way. */
export async function writeFileAtomic(filename: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content)
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** The on-disk document. */
export interface StoreFile {
  schemaVersion: number
  /** Monotonic write counter; 0 means the file was never written. */
  revision: number
  /** Last write timestamp (ISO). */
  savedAt: string
  config: PersonalizationConfig
}

/** One immutable read of the store. */
export interface StoreSnapshot {
  revision: number
  config: PersonalizationConfig
  /** Whether a store file currently exists on disk (never written = false). */
  written: boolean
}

/** Serialize the in-memory state into the on-disk document. */
function serialize(revision: number, config: PersonalizationConfig): string {
  const doc: StoreFile = {
    schemaVersion: STORE_SCHEMA_VERSION,
    revision,
    savedAt: new Date().toISOString(),
    config,
  }
  return JSON.stringify(doc)
}

/**
 * The personalization configuration store. All reads await an initial load;
 * all writes are serialized through one promise chain so a read-modify-write
 * cycle can never interleave.
 */
export class PersonalizationStore {
  readonly filePath: string
  readonly assetsDir: string

  private revision = 0
  private config: PersonalizationConfig = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  private written = false
  private lastGood: { revision: number; config: PersonalizationConfig } | null = null
  private readonly ready: Promise<void>
  private writeChain: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(revision: number) => void>()

  constructor(home?: string) {
    const root = home ?? dshHome()
    this.filePath = join(root, CONFIG_FILENAME)
    this.assetsDir = join(root, ASSETS_DIRNAME)
    this.ready = this.load()
  }

  /** Initial load: read + sanitize, or keep defaults; corrupt files are backed up. */
  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      // ENOENT = never written (defaults). Anything else (EACCES…) also falls
      // back to defaults; the first successful write recreates the file.
      return
    }
    this.written = true
    try {
      const doc = JSON.parse(raw) as Record<string, unknown>
      const config = sanitizeConfig(doc.config)
      const revision = typeof doc.revision === 'number' && Number.isFinite(doc.revision) && doc.revision >= 0
        ? Math.floor(doc.revision)
        : 0
      this.config = config
      this.revision = revision
      this.lastGood = { revision, config }
    } catch {
      // Corrupt document: preserve it for inspection, keep defaults/last good.
      await this.backupCorrupt()
    }
  }

  /** Rename the unreadable file to a timestamped backup instead of deleting. */
  private async backupCorrupt(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${stamp}`)
      this.written = false
    } catch {
      // Backup failed (locked/permissions); leave the file in place.
    }
  }

  /** Serialize one write operation behind all previously queued ones. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(op, op)
    this.writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  /** Persist the current in-memory document. */
  private async writeFile(): Promise<void> {
    await writeFileAtomic(this.filePath, serialize(this.revision, this.config))
    this.written = true
  }

  /** Current revision + config (awaits the initial load). */
  async getSnapshot(): Promise<StoreSnapshot> {
    await this.ready
    return { revision: this.revision, config: this.config, written: this.written }
  }

  /** Sanitize + persist a full config document, bumping the revision. */
  async update(input: unknown): Promise<StoreSnapshot> {
    const config = sanitizeConfig(input)
    return this.enqueue(async () => {
      await this.ready
      this.revision += 1
      this.config = config
      this.lastGood = { revision: this.revision, config }
      await this.writeFile()
      this.broadcast(this.revision)
      return { revision: this.revision, config, written: true }
    })
  }

  /** Deep-merge a partial patch into the current document, then sanitize +
   *  persist. Undefined fields are left untouched; null clears (e.g. an image
   *  or accent). */
  async patch(patch: unknown): Promise<StoreSnapshot> {
    return this.enqueue(async () => {
      await this.ready
      const merged = deepMerge(this.config, patch)
      this.revision += 1
      this.config = sanitizeConfig(merged)
      this.lastGood = { revision: this.revision, config: this.config }
      await this.writeFile()
      this.broadcast(this.revision)
      return { revision: this.revision, config: this.config, written: true }
    })
  }

  /** Persist the default configuration (bumps the revision). */
  async reset(): Promise<StoreSnapshot> {
    return this.update(structuredClone(DEFAULT_CONFIG) as PersonalizationConfig)
  }

  /** Uninstall cleanup: remove the config file and the asset directory. */
  async uninstall(): Promise<void> {
    await this.enqueue(async () => {
      await this.ready
      await rm(this.filePath, { force: true })
      await rm(this.assetsDir, { recursive: true, force: true })
      this.revision = 0
      this.written = false
      this.config = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
      this.lastGood = null
      this.broadcast(0)
    })
  }

  /** Observe committed writes (revision of the new document). */
  subscribe(listener: (revision: number) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private broadcast(revision: number): void {
    for (const listener of this.listeners) listener(revision)
  }
}
