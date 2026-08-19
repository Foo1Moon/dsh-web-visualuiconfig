/**
 * Ramp derivation, chrome inputs, token resolution and the readability audit.
 * Ported from deepseek-harness-skin's tests/derive.client.spec.ts (MIT).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditSkin, BG_STEP, CONTRACT, deriveSkin, resolveToken, type SkinTheme,
} from '../../src/shared/derive.ts'
import { composite, contrast, hexToOklch, parseColor } from '../../src/shared/color.ts'
import type { StockData, StockStep } from '../../src/shared/stock.ts'
import { STOCK } from '../../src/shared/stock.generated.ts'

const LIGHT: SkinTheme = {
  id: 'spec-light',
  appearance: 'light',
  chrome: 'glass',
  seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
}

const DARK: SkinTheme = {
  id: 'spec-dark',
  appearance: 'dark',
  chrome: 'neon',
  seeds: { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' },
}

/** Read one `rgba(r, g, b, a)` value's alpha. */
function alphaOf(value: string): number {
  const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(value)?.[1]
  if (alpha === undefined) throw new Error(`not an rgba value: ${value}`)
  return Number(alpha)
}

/** One synthetic palette step. */
function step(name: string, L: number, C: number, h: number): StockStep {
  return { name, L, C, h }
}

/** A minimal well-formed stock for bending one part of upstream's palette. */
function synthStock(): StockData {
  const bluish = [
    step('--dsw-static-neutral-bluish-00', 1, 0.001, 250),
    step('--dsw-static-neutral-bluish-400', 0.7, 0.008, 250),
    step('--dsw-static-neutral-bluish-950', 0.16, 0.01, 250),
    step('--dsw-static-neutral-bluish-1000', 0.1, 0.01, 250),
  ]
  return {
    families: {
      '--dsw-static-neutral-bluish': bluish,
      '--dsw-static-neutral': [
        step('--dsw-static-neutral-00', 1, 0, 0),
        step('--dsw-static-neutral-500', 0.6, 0, 0),
        step('--dsw-static-neutral-1000', 0.12, 0, 0),
      ],
      '--dsw-static-deepseek': [
        step('--dsw-static-deepseek-300', 0.8, 0.09, 260),
        step('--dsw-static-deepseek-500', 0.6, 0.15, 260),
        step('--dsw-static-deepseek-700', 0.4, 0.11, 260),
      ],
      '--dsw-static-blue': [
        step('--dsw-static-blue-300', 0.82, 0.08, 240),
        step('--dsw-static-blue-500', 0.62, 0.14, 240),
      ],
      '--dsw-static-blue-50p': [step('--dsw-static-blue-50p', 0.95, 0.03, 240)],
    },
    hex: {
      '--dsw-static-neutral-bluish-00': '#ffffff',
      '--dsw-static-neutral-bluish-950': '#1c1c22',
    },
    aliases: {
      light: { '--dsw-alias-label-primary-foreground': 'var(--dsw-static-neutral-bluish-00)' },
      dark: { '--dsw-alias-label-primary-foreground': 'var(--dsw-static-neutral-bluish-00)' },
    },
  }
}

describe('deriveSkin against upstream stock', () => {
  it('pins the page background on the surface seed verbatim', () => {
    assert.equal(deriveSkin(LIGHT, STOCK).palette[BG_STEP.light], LIGHT.seeds.surface)
    assert.equal(deriveSkin(DARK, STOCK).palette[BG_STEP.dark], DARK.seeds.surface)
  })

  it('clears every readability contract for both schemes', () => {
    for (const theme of [LIGHT, DARK]) {
      const entries = auditSkin(theme, deriveSkin(theme, STOCK), STOCK)
      assert.equal(entries.length, CONTRACT.length + 1)
      assert.deepEqual(entries.filter(entry => !entry.pass), [])
    }
  })

  it('keeps the neutral ramp ordered from the light end to the dark end', () => {
    const { palette } = deriveSkin(LIGHT, STOCK)
    const bluish = STOCK.families['--dsw-static-neutral-bluish'] ?? []
    const lightness = bluish.map(s => hexToOklch(palette[s.name] ?? '#000000')[0])
    for (let i = 1; i < lightness.length; i += 1) {
      assert.ok((lightness[i] ?? 0) <= (lightness[i - 1] ?? 0) + 1e-9)
    }
  })

  it('paints the band with a foreground that reads on it', () => {
    for (const theme of [LIGHT, DARK]) {
      const { chrome } = deriveSkin(theme, STOCK)
      const ink = chrome['--skin-band-ink'] ?? ''
      assert.ok(contrast(ink, chrome['--skin-band-from'] ?? '') >= 4.5)
      assert.ok(contrast(ink, chrome['--skin-band-to'] ?? '') >= 4.5)
    }
  })

  it('stacks the transcript wash onto the frame wash without changing the result', () => {
    const { chrome } = deriveSkin(DARK, STOCK)
    const surface = DARK.seeds.surface
    const photo = '#c0d8ff'
    const soft = composite(surface, alphaOf(chrome['--skin-veil-soft'] ?? ''), photo)
    const stacked = parseColor(composite(surface, alphaOf(chrome['--skin-veil-over'] ?? ''), soft))
    const once = parseColor(composite(surface, alphaOf(chrome['--skin-veil'] ?? ''), photo))
    for (const [i, channel] of stacked.entries()) {
      assert.ok(Math.abs(channel - (once[i] ?? 0)) <= 1)
    }
  })

  it('takes a tuned veil over the per-appearance default', () => {
    const plain = deriveSkin(DARK, STOCK).chrome['--skin-veil'] ?? ''
    const tuned = deriveSkin({ ...DARK, veil: 0.94 }, STOCK).chrome['--skin-veil'] ?? ''
    assert.ok(Math.abs(alphaOf(plain) - 0.86) < 0.5 * 10 ** -6)
    assert.ok(Math.abs(alphaOf(tuned) - 0.94) < 0.5 * 10 ** -6)
    const softTuned = alphaOf(deriveSkin({ ...DARK, veil: 0.94 }, STOCK).chrome['--skin-veil-soft'] ?? '')
    const softPlain = alphaOf(deriveSkin(DARK, STOCK).chrome['--skin-veil-soft'] ?? '')
    assert.ok(softTuned > softPlain)
  })

  it('brightens a dark skin accent rather than darkening it', () => {
    const dim: SkinTheme = { ...DARK, id: 'spec-dim', seeds: { ...DARK.seeds, accent: '#0a1420' } }
    const derived = deriveSkin(dim, STOCK)
    assert.ok(derived.moved > 0)
    const fitted = hexToOklch(derived.brand['--dsw-alias-brand-primary'] ?? '')[0]
    assert.ok(fitted > hexToOklch(dim.seeds.accent)[0])
  })

  it('saturates a dark skin at the light end when brightening cannot help', () => {
    const inverted: SkinTheme = {
      id: 'spec-inverted',
      appearance: 'dark',
      chrome: 'flat',
      seeds: { accent: '#f2f2f4', secondary: '#e8e8ee', surface: '#ffffff', text: '#000000' },
    }
    assert.equal(deriveSkin(inverted, STOCK).brand['--dsw-alias-brand-primary'], '#ffffff')
  })

  it('saturates the accent fit when no lightness can reach the threshold', () => {
    const trapped: SkinTheme = {
      id: 'spec-trapped',
      appearance: 'light',
      chrome: 'flat',
      seeds: { accent: '#101012', secondary: '#202024', surface: '#000000', text: '#ffffff' },
    }
    const derived = deriveSkin(trapped, STOCK)
    assert.equal(derived.brand['--dsw-alias-brand-primary'], '#000000')
    assert.ok(derived.moved > 0)
    assert.equal(auditSkin(trapped, derived, STOCK).some(entry => !entry.pass), true)
  })
})

describe('deriveSkin against a bent stock', () => {
  it('names the family it cannot find', () => {
    const stock = synthStock()
    delete stock.families['--dsw-static-deepseek']
    assert.throws(() => deriveSkin(LIGHT, stock), /missing --dsw-static-deepseek/)
  })

  it('names the background step it cannot find', () => {
    const stock = synthStock()
    stock.hex = Object.fromEntries(Object.entries(stock.hex).filter(([step]) => step !== BG_STEP.light))
    assert.throws(() => deriveSkin(LIGHT, stock), /missing --dsw-static-neutral-bluish-00/)
  })

  it('falls back to the middle step when the accent anchor is missing', () => {
    const stock = synthStock()
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-300', 0.8, 0.09, 260),
      step('--dsw-static-deepseek-450', 0.6, 0.15, 260),
      step('--dsw-static-deepseek-700', 0.4, 0.11, 260),
    ]
    const { palette } = deriveSkin(LIGHT, stock)
    assert.equal(palette['--dsw-static-deepseek-450'], LIGHT.seeds.accent)
  })

  it('keeps the stock chroma silhouette when the anchor is achromatic', () => {
    const stock = synthStock()
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-500', 0.6, 0, 0),
      step('--dsw-static-deepseek-700', 0.4, 0, 0),
    ]
    const chroma = hexToOklch(deriveSkin(LIGHT, stock).palette['--dsw-static-deepseek-700'] ?? '')[1]
    assert.ok(chroma < 0.001)
  })

  it('collapses a ramp whose steps are a rounding step apart', () => {
    const stock = synthStock()
    stock.families['--dsw-static-deepseek'] = [
      step('--dsw-static-deepseek-500', 0.6, 0.15, 260),
      step('--dsw-static-deepseek-700', 0.6 - 1e-9, 0.15, 260),
    ]
    const { palette } = deriveSkin(LIGHT, stock)
    assert.equal(palette['--dsw-static-deepseek-700'], LIGHT.seeds.accent)
  })

  it('collapses a one-step ramp onto the seed', () => {
    const stock = synthStock()
    stock.families['--dsw-static-blue'] = [step('--dsw-static-blue-500', 0.62, 0.14, 240)]
    stock.families['--dsw-static-neutral'] = [step('--dsw-static-neutral-500', 0.6, 0, 0)]
    const { palette } = deriveSkin(LIGHT, stock)
    assert.equal(palette['--dsw-static-blue-500'], LIGHT.seeds.secondary)
    assert.match(palette['--dsw-static-neutral-500'] ?? '', /^#[0-9a-f]{6}$/)
  })

  it('names the foreground token it cannot resolve', () => {
    const stock = synthStock()
    stock.aliases.light['--dsw-alias-label-primary-foreground'] = 'var(--dsw-static-nope)'
    assert.throws(() => deriveSkin(LIGHT, stock), /missing --dsw-static-nope/)
  })
})

describe('resolveToken', () => {
  const palette = { '--dsw-static-x': '#123456' }

  it('reads a palette step directly', () => {
    assert.equal(resolveToken('--dsw-static-x', {}, palette), '#123456')
  })

  it('follows a var() chain down to a step', () => {
    const aliases = { '--a': 'var(--b)', '--b': 'var(--dsw-static-x)' }
    assert.equal(resolveToken('--a', aliases, palette), '#123456')
  })

  it('gives up on a cycle instead of recursing forever', () => {
    assert.equal(resolveToken('--a', { '--a': 'var(--b)', '--b': 'var(--a)' }, palette), null)
  })

  it('gives up when the chain ends nowhere', () => {
    assert.equal(resolveToken('--gone', {}, palette), null)
  })

  it('reads a literal colour declaration', () => {
    assert.equal(resolveToken('--a', { '--a': 'rgb(18, 52, 86)' }, palette), '#123456')
  })

  it('skips a translucent declaration, whose backdrop is unknown', () => {
    assert.equal(resolveToken('--a', { '--a': 'rgba(0, 0, 0, 0.4)' }, palette), null)
  })

  it('gives up on a declaration that is not a colour at all', () => {
    assert.equal(resolveToken('--a', { '--a': '1px solid currentColor' }, palette), null)
  })
})

describe('auditSkin', () => {
  it('passes a pair that resolves to nothing, because it paints nothing', () => {
    const derived = deriveSkin(LIGHT, STOCK)
    const blind: StockData = { ...STOCK, aliases: { light: {}, dark: {} } }
    const entries = auditSkin(LIGHT, derived, blind)
    const unresolved = entries.filter(entry => entry.ratio === null)
    assert.ok(unresolved.length > 0)
    assert.equal(unresolved.every(entry => entry.pass), true)
  })

  it('measures the chrome band against every gradient stop', () => {
    const derived = deriveSkin(LIGHT, STOCK)
    const band = auditSkin(LIGHT, derived, STOCK).at(-1)
    assert.equal(band?.label, '色带文字')
    const stops = ['--skin-band-from', '--skin-band-to']
      .map(name => contrast(derived.chrome['--skin-band-ink'] ?? '', derived.chrome[name] ?? ''))
    assert.ok(band?.ratio !== null && band !== undefined && Math.abs(band.ratio - Math.min(...stops)) < 0.5 * 10 ** -10)
  })
})
