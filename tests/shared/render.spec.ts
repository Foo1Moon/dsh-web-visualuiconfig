/**
 * Skin CSS formatting — attribute-scoped emission of a derived theme.
 * Ported (renderSkinCss part) from deepseek-harness-skin's
 * tests/render.client.spec.ts (MIT). The custom-skin half of the original
 * spec belongs to the wizard phase (src/client/custom-skin.ts) and will be
 * ported together with it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSkin, type SkinTheme } from '../../src/shared/derive.ts'
import { renderSkinCss } from '../../src/shared/render.ts'
import { STOCK } from '../../src/shared/stock.generated.ts'

const BARE: SkinTheme = {
  id: 'bare',
  appearance: 'light',
  chrome: 'flat',
  seeds: { accent: '#1a7f8c', secondary: '#8c5a1a', surface: '#f4f1ea', text: '#241f1a' },
}

const DRESSED: SkinTheme = {
  ...BARE,
  id: 'dressed',
  hero: 'hero.webp',
  heroFocus: '30% 70%',
  glyph: '🐟',
  showBadge: true,
  font: '"SimSun", serif',
}

/** Render one theme against upstream stock. */
function render(theme: SkinTheme): string {
  return renderSkinCss(theme, deriveSkin(theme, STOCK), hero => `url("./${hero}")`)
}

describe('renderSkinCss', () => {
  it('scopes the chrome block to the active body and to the preview swatch', () => {
    const css = render(BARE)
    assert.ok(css.includes("body[data-dsh-skin='bare'],\n[data-skin-preview='bare'] {"))
    assert.ok(css.includes('  --skin-accent: #1a7f8c;'))
    assert.equal(css.endsWith('\n'), true)
  })

  it('records the seeds it was built from', () => {
    assert.ok(render(BARE).includes('/* seeds: accent #1a7f8c · secondary #8c5a1a'))
  })

  it('leaves out what a bare skin does not declare', () => {
    const css = render(BARE)
    assert.ok(!css.includes('--skin-hero'))
    assert.ok(!css.includes('--skin-glyph'))
    assert.ok(!css.includes('--skin-badge'))
    assert.ok(!css.includes('--dsw-font-family'))
  })

  it('emits hero, glyph, badge and font when the skin declares them', () => {
    const css = render(DRESSED)
    assert.ok(css.includes('  --skin-hero: url("./hero.webp");'))
    assert.ok(css.includes('  --skin-hero-focus: 30% 70%;'))
    assert.ok(css.includes("  --skin-glyph: '🐟';"))
    assert.ok(css.includes('  --skin-badge: inline-block;'))
    assert.ok(css.includes('  --dsw-font-family: "SimSun", serif;'))
  })

  it('centres a hero that names no focus', () => {
    const { heroFocus: _drop, ...centred } = DRESSED
    assert.ok(render(centred).includes('  --skin-hero-focus: 50% 50%;'))
  })

  it('sorts the palette and brand blocks so the generated files stay diffable', () => {
    const names = [...render(BARE).matchAll(/^ {2}(--dsw-static-[a-z0-9-]+):/gm)].map(m => m[1] ?? '')
    assert.deepEqual(names, [...names].sort())
  })
})
