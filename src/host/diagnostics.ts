/**
 * Host-side diagnostics log: the browser engine reports every applied
 * personalization (config knobs, emitted CSS, live layout measurements) here
 * as JSONL, so a reproduced layout/rendering bug can be diagnosed from the
 * file without a headless browser.
 *
 * The log lives at `~/.dsh/personalization-diagnostics.jsonl` and keeps only
 * the most recent entries (a ring, not a growth hazard). It is written
 * atomically through the same tmp+rename protocol as the config file.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './store.ts'

/** Diagnostics file name under the dsh home. */
export const DIAGNOSTICS_FILENAME = 'personalization-diagnostics.jsonl'

/** How many entries the log keeps (oldest dropped first). */
export const DIAGNOSTICS_KEEP = 40

/**
 * Append one diagnostics entry to the JSONL ring log.
 * @param home - the dsh home directory (the store's file parent).
 * @param entry - the JSON-serializable entry (client reports).
 * @returns the log file path.
 */
export async function appendDiagnostics(home: string, entry: unknown): Promise<string> {
  const path = join(home, DIAGNOSTICS_FILENAME)
  const line = JSON.stringify(entry)
  let lines: string[] = []
  try {
    const raw = await readFile(path, 'utf8')
    lines = raw.split('\n').filter(l => l.trim() !== '')
  } catch {
    // ENOENT: first entry; anything else also falls back to an empty log.
  }
  lines.push(line)
  if (lines.length > DIAGNOSTICS_KEEP) lines = lines.slice(lines.length - DIAGNOSTICS_KEEP)
  await writeFileAtomic(path, `${lines.join('\n')}\n`)
  return path
}

/** Read the diagnostics log entries (newest last); empty when absent. */
export async function readDiagnostics(home: string): Promise<unknown[]> {
  try {
    const raw = await readFile(join(home, DIAGNOSTICS_FILENAME), 'utf8')
    const entries: unknown[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        entries.push(JSON.parse(trimmed))
      } catch {
        // Skip a malformed line rather than failing the whole read.
      }
    }
    return entries
  } catch {
    return []
  }
}
