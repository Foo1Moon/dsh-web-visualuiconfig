/**
 * Host diagnostics log tests: append/re-read round-trip, ring cap, and
 * malformed-line tolerance.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendDiagnostics, readDiagnostics, DIAGNOSTICS_KEEP } from '../../src/host/diagnostics.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'personal-diag-'))
}

test('appendDiagnostics writes one JSONL entry per report', async () => {
  const home = await tempHome()
  try {
    await appendDiagnostics(home, { t: 1, pin: 'dark', config: { base: { glass: { opacity: 0.6 } } } })
    await appendDiagnostics(home, { t: 2, pin: null })
    const entries = await readDiagnostics(home)
    assert.equal(entries.length, 2)
    assert.equal((entries[0] as { t: number }).t, 1)
    assert.equal((entries[1] as { pin: string | null }).pin, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('appendDiagnostics caps the log at DIAGNOSTICS_KEEP entries (ring)', async () => {
  const home = await tempHome()
  try {
    for (let i = 0; i < DIAGNOSTICS_KEEP + 10; i += 1) {
      await appendDiagnostics(home, { i })
    }
    const entries = await readDiagnostics(home)
    assert.equal(entries.length, DIAGNOSTICS_KEEP)
    // The oldest entries were dropped; the newest are kept.
    assert.equal((entries[0] as { i: number }).i, 10)
    assert.equal((entries[DIAGNOSTICS_KEEP - 1] as { i: number }).i, DIAGNOSTICS_KEEP + 9)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('readDiagnostics tolerates a malformed line and an absent file', async () => {
  const home = await tempHome()
  try {
    await writeFile(join(home, 'personalization-diagnostics.jsonl'), '{bad json}\n{"ok":true}\n', 'utf8')
    const entries = await readDiagnostics(home)
    assert.equal(entries.length, 1)
    assert.equal((entries[0] as { ok: boolean }).ok, true)
    // Absent file reads as an empty list.
    const other = await mkdtemp(join(tmpdir(), 'personal-diag-empty-'))
    try {
      assert.deepEqual(await readDiagnostics(other), [])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
