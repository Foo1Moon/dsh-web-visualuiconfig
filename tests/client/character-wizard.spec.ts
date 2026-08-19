/**
 * Character-theme extraction wizard tests: the pure pixel-analysis half
 * (extractPalette + tuneCustomSkin wired together). The DOM sampler
 * (samplePixelsFromDataUrl) is a thin canvas wrapper and is not unit-tested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseColor } from '../../src/shared/color.ts'
import { analyzeImagePixels } from '../../src/client/character-wizard.ts'

/** Build an RGBA buffer out of colour blocks. */
function image(blocks: readonly { hex: string; count: number }[]): Uint8ClampedArray {
  const total = blocks.reduce((sum, block) => sum + block.count, 0)
  const out = new Uint8ClampedArray(total * 4)
  let at = 0
  for (const block of blocks) {
    const [r, g, b] = parseColor(block.hex)
    for (let i = 0; i < block.count; i += 1) {
      out[at] = r
      out[at + 1] = g
      out[at + 2] = b
      out[at + 3] = 255
      at += 4
    }
  }
  return out
}

test('analyzeImagePixels reads a light scheme off a bright picture', () => {
  const analysis = analyzeImagePixels(image([
    { hex: '#f6f0e4', count: 700 },
    { hex: '#c8873a', count: 200 },
    { hex: '#3a6ec8', count: 100 },
  ]))
  assert.equal(analysis.appearance, 'light')
  assert.equal(analysis.pass, true)
  assert.ok(analysis.veil >= 0.82)
  assert.match(analysis.seeds.accent, /^#[0-9a-f]{6}$/)
  assert.match(analysis.seeds.secondary, /^#[0-9a-f]{6}$/)
  assert.match(analysis.seeds.surface, /^#[0-9a-f]{6}$/)
  assert.match(analysis.seeds.text, /^#[0-9a-f]{6}$/)
})

test('analyzeImagePixels reads a dark scheme off a night picture', () => {
  const analysis = analyzeImagePixels(image([
    { hex: '#141018', count: 800 },
    { hex: '#7a3fd0', count: 200 },
  ]))
  assert.equal(analysis.appearance, 'dark')
  assert.equal(analysis.pass, true)
})

test('analyzeImagePixels refuses a picture with nothing opaque in it', () => {
  const pixels = image([{ hex: '#000000', count: 40 }])
  // Zero alpha everywhere: the histogram sees no pixels.
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0
  assert.throws(() => analyzeImagePixels(pixels), /no opaque pixels/)
})
