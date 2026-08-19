/**
 * OKLab/OKLCh conversion chain, gamut fitting and the contrast helpers.
 * Ported from deepseek-harness-skin's tests/color.client.spec.ts (MIT).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  composite, contrast, fitGamut, hexToLinear, hexToOklch, linearToHex, linearToOklab, luminance,
  oklabToLinear, oklabToOklch, oklchToHex, oklchToOklab, parseColor, rgba, rgbToHex,
} from '../../src/shared/color.ts'

describe('parseColor', () => {
  it('reads the three notations design tokens are written in', () => {
    assert.deepEqual(parseColor('#4d6bfe'), [77, 107, 254])
    assert.deepEqual(parseColor('#abc'), [170, 187, 204])
    assert.deepEqual(parseColor('rgb(20, 30, 40)'), [20, 30, 40])
    assert.deepEqual(parseColor('rgba(20 30 40 / 0.5)'), [20, 30, 40])
  })

  it('rounds and clamps channels rather than emitting an impossible colour', () => {
    assert.deepEqual(parseColor('rgb(300, 40.4, 12.6)'), [255, 40, 13])
  })

  it('rejects anything that is not a colour', () => {
    assert.throws(() => parseColor('cornflower'), /bad color/)
    assert.throws(() => parseColor('#12345'), /bad color/)
  })
})

describe('conversion chain', () => {
  it('round-trips hex through every representation', () => {
    for (const hex of ['#000000', '#ffffff', '#4d6bfe', '#e8b540', '#201f22']) {
      assert.equal(linearToHex(hexToLinear(hex)), hex)
      assert.equal(oklchToHex(hexToOklch(hex)), hex)
      const lab = linearToOklab(hexToLinear(hex))
      assert.equal(linearToHex(oklabToLinear(lab)), hex)
      const back = oklchToOklab(oklabToOklch(lab))[0]
      assert.ok(Math.abs(back - lab[0]) < 0.5 * 10 ** -10)
    }
  })

  it('formats 8-bit triples with padding', () => {
    assert.equal(rgbToHex([0, 8, 255]), '#0008ff')
  })

  it('keeps hue meaningful for greys', () => {
    const [, C, h] = hexToOklch('#808080')
    assert.ok(C < 0.001)
    assert.equal(Number.isFinite(h), true)
  })
})

describe('fitGamut', () => {
  it('leaves an in-gamut colour alone', () => {
    const inside = hexToOklch('#4d6bfe')
    assert.equal(linearToHex(fitGamut(inside)), '#4d6bfe')
  })

  it('pulls chroma back until an out-of-gamut request renders', () => {
    const fitted = fitGamut([0.5, 0.6, 29])
    for (const channel of fitted) {
      assert.ok(channel >= -1e-3)
      assert.ok(channel <= 1 + 1e-3)
    }
    assert.match(linearToHex(fitted), /^#[0-9a-f]{6}$/)
  })

  it('handles the achromatic extremes', () => {
    assert.equal(linearToHex(fitGamut([0, 0, 0])), '#000000')
    assert.equal(linearToHex(fitGamut([1, 0, 0])), '#ffffff')
  })
})

describe('contrast helpers', () => {
  it('reproduces the known WCAG anchors', () => {
    assert.ok(Math.abs(luminance('#ffffff') - 1) < 0.5 * 10 ** -6)
    assert.ok(Math.abs(luminance('#000000') - 0) < 0.5 * 10 ** -6)
    assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 0.5 * 10 ** -4)
    assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.5 * 10 ** -4)
    assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 0.5 * 10 ** -6)
  })

  it('formats an alpha layer as rgba', () => {
    assert.equal(rgba('#4d6bfe', 0.5), 'rgba(77, 107, 254, 0.5)')
  })

  it('composites a translucent layer onto its backdrop', () => {
    assert.equal(composite('#ffffff', 0, '#201f22'), '#201f22')
    assert.equal(composite('#ffffff', 1, '#201f22'), '#ffffff')
    assert.equal(composite('#000000', 0.5, '#ffffff'), '#808080')
  })
})
