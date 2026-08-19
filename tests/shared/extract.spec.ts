/**
 * Reading a skin out of a photograph, and tuning its wash until text reads.
 * Ported from deepseek-harness-skin's tests/extract.client.spec.ts (MIT).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractPalette, tuneCustomSkin, type ExtractedPalette } from '../../src/shared/extract.ts'
import { hexToOklch, parseColor } from '../../src/shared/color.ts'
import type { StockData } from '../../src/shared/stock.ts'
import { STOCK } from '../../src/shared/stock.generated.ts'

/** One block of an imaginary photograph: a colour and how many pixels it covers. */
interface Block {
  /** The colour, as hex or `#rrggbbaa`. */
  hex: string
  /** How many pixels carry it. */
  count: number
}

/** Build an RGBA buffer out of colour blocks (a canvas layout). */
function image(blocks: readonly Block[], trailing = 0): Uint8ClampedArray {
  const total = blocks.reduce((sum, block) => sum + block.count, 0)
  const out = new Uint8ClampedArray(total * 4 + trailing)
  let at = 0
  for (const block of blocks) {
    const [r, g, b] = parseColor(block.hex.slice(0, 7))
    const alpha = block.hex.length === 9 ? Number.parseInt(block.hex.slice(7), 16) : 255
    for (let i = 0; i < block.count; i += 1) {
      out[at] = r
      out[at + 1] = g
      out[at + 2] = b
      out[at + 3] = alpha
      at += 4
    }
  }
  return out
}

/** A photograph with no colour big enough to clear the area floor. */
function gradient(): Uint8ClampedArray {
  const blocks: Block[] = []
  for (let i = 0; i < 300; i += 1) {
    const r = (i % 10) * 25
    const g = (Math.floor(i / 10) % 10) * 25
    const b = Math.floor(i / 100) * 80
    blocks.push({ hex: `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`, count: 1 })
  }
  return image(blocks)
}

describe('extractPalette', () => {
  it('reads a light scheme off a bright picture and keeps its hue', () => {
    const { seeds, appearance, chrome } = extractPalette(image([
      { hex: '#f6f0e4', count: 700 },
      { hex: '#c8873a', count: 200 },
      { hex: '#3a6ec8', count: 100 },
    ]))
    assert.equal(appearance, 'light')
    assert.equal(chrome, 'glass')
    assert.ok(hexToOklch(seeds.surface)[0] > 0.9)
    assert.ok(hexToOklch(seeds.surface)[1] <= 0.03)
    assert.ok(hexToOklch(seeds.accent)[1] > 0.06)
    const gap = Math.abs(((hexToOklch(seeds.secondary)[2] - hexToOklch(seeds.accent)[2] + 540) % 360) - 180)
    assert.ok(gap > 25)
  })

  it('reads a dark scheme off a night picture', () => {
    const { seeds, appearance, chrome } = extractPalette(image([
      { hex: '#141018', count: 800 },
      { hex: '#7a3fd0', count: 200 },
    ]))
    assert.equal(appearance, 'dark')
    assert.equal(chrome, 'neon')
    assert.ok(hexToOklch(seeds.surface)[0] <= 0.24)
    assert.ok(Math.abs(hexToOklch(seeds.text)[0] - 0.93) < 0.5 * 10 ** -2)
  })

  it('invents a neighbouring hue when the picture tells one colour story', () => {
    const { seeds } = extractPalette(image([
      { hex: '#f2ece0', count: 700 },
      { hex: '#c8873a', count: 300 },
    ]))
    const gap = ((hexToOklch(seeds.secondary)[2] - hexToOklch(seeds.accent)[2] + 360) % 360)
    assert.ok(gap > 0)
    assert.ok(gap < 40)
  })

  it('falls back to the dominant colour when nothing sits in the accent band', () => {
    const { seeds } = extractPalette(image([
      { hex: '#000000', count: 600 },
      { hex: '#ffffff', count: 400 },
    ]))
    assert.match(seeds.accent, /^#[0-9a-f]{6}$/)
    assert.ok(Math.abs(hexToOklch(seeds.accent)[1] - 0.06) < 0.5 * 10 ** -2)
  })

  it('samples the heaviest buckets when a gradient clears no area floor', () => {
    const { seeds, extremes } = extractPalette(gradient())
    assert.match(seeds.surface, /^#[0-9a-f]{6}$/)
    assert.equal(extremes.length, 2)
  })

  it('brackets the picture with its darkest and brightest colours', () => {
    const { extremes } = extractPalette(image([
      { hex: '#808080', count: 500 },
      { hex: '#101010', count: 300 },
      { hex: '#f0f0f0', count: 200 },
    ]))
    assert.equal(extremes[0], '#101010')
    assert.equal(extremes[1], '#f0f0f0')
  })

  it('ignores transparent pixels and a truncated trailing pixel', () => {
    const opaque = extractPalette(image([{ hex: '#c8873a', count: 400 }]))
    const padded = extractPalette(image([
      { hex: '#c8873a', count: 400 },
      { hex: '#00ff0004', count: 200 },
    ], 3))
    assert.deepEqual(padded, opaque)
  })

  it('refuses a picture with nothing opaque in it', () => {
    assert.throws(() => extractPalette(image([{ hex: '#00000000', count: 40 }])), /no opaque pixels/)
  })
})

describe('tuneCustomSkin', () => {
  /** A palette that would come off a plausible photograph. */
  const readable: ExtractedPalette = {
    seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
    appearance: 'light',
    chrome: 'glass',
    extremes: ['#d8d2c6', '#faf7f0'],
  }

  it('settles on the default wash when the picture does not fight the text', () => {
    const tuned = tuneCustomSkin(readable, STOCK)
    assert.equal(tuned.pass, true)
    assert.ok(Math.abs(tuned.theme.veil - 0.82) < 0.5 * 10 ** -6)
    assert.equal(tuned.theme.id, 'custom')
    assert.equal(tuned.composited.length, 3)
  })

  it('starts a dark skin at a heavier wash than a light one', () => {
    const dark: ExtractedPalette = {
      seeds: { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' },
      appearance: 'dark',
      chrome: 'neon',
      extremes: ['#1b1b22', '#2e2e3a'],
    }
    const tuned = tuneCustomSkin(dark, STOCK)
    assert.equal(tuned.theme.appearance, 'dark')
    assert.ok(Math.abs(tuned.theme.veil - 0.86) < 0.5 * 10 ** -6)
    assert.equal(tuned.pass, true)
  })

  it('raises the wash until a punishing picture stops eating the contrast', () => {
    const harsh: ExtractedPalette = { ...readable, extremes: ['#000000', '#ffffff'] }
    const tuned = tuneCustomSkin(harsh, STOCK)
    assert.ok((tuned.theme.veil ?? 0) > 0.82)
    assert.equal(tuned.pass, true)
    assert.equal(tuned.composited.every(entry => entry.pass), true)
  })

  it('stops at the ceiling and reports the failure when the seeds are the problem', () => {
    const doomed: ExtractedPalette = {
      seeds: { accent: '#8a8a8a', secondary: '#909090', surface: '#242424', text: '#f0f0f0' },
      appearance: 'light',
      chrome: 'flat',
      extremes: ['#000000', '#ffffff'],
    }
    const tuned = tuneCustomSkin(doomed, STOCK)
    assert.ok(Math.abs(tuned.theme.veil - 0.98) < 0.5 * 10 ** -6)
    assert.equal(tuned.pass, false)
  })

  it('passes a role whose alias chain leads nowhere, because it paints nothing', () => {
    const kept = { '--dsw-alias-label-primary-foreground': STOCK.aliases.light['--dsw-alias-label-primary-foreground'] ?? '' }
    const blind: StockData = { ...STOCK, aliases: { light: kept, dark: kept } }
    const tuned = tuneCustomSkin(readable, blind)
    assert.equal(tuned.composited.length, 3)
    assert.equal(tuned.composited.every(entry => entry.ratio === null && entry.pass), true)
  })

  it('reports a composited ratio no better than the bare surface managed', () => {
    const tuned = tuneCustomSkin(readable, STOCK)
    const body = tuned.composited.find(entry => entry.label === '正文')?.ratio ?? 0
    const bare = tuned.audit.find(entry => entry.label === '正文')?.ratio ?? 0
    assert.ok(body >= 4.5)
    assert.ok(body <= bare)
  })
})
