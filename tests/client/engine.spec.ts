/**
 * Engine integration tests (jsdom): the attribute-scoped stylesheet, the
 * independent fixed backdrop layer, the derived seeds palette, the scheme
 * pin, and the disposer retracting every write.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { applyPersonalization } from '../../src/client/engine.ts'
import { DEFAULT_CONFIG, type PersonalizationConfig } from '../../src/shared/config.ts'

let dom: JSDOM
let body: HTMLElement
let head: HTMLElement

before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  })
  body = dom.window.document.body
  head = dom.window.document.head
})

after(() => {
  dom.window.close()
})

function configWith(patch: Partial<PersonalizationConfig>): PersonalizationConfig {
  const base = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  return { ...base, ...patch }
}

/** The injected stylesheet, or null. */
function injectedStyle(): HTMLStyleElement | null {
  return head.querySelector<HTMLStyleElement>('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]')
}

/** The fixed backdrop layer, or null. */
function backdropLayer(): HTMLDivElement | null {
  return body.querySelector<HTMLDivElement>('[data-dsh-personal-backdrop]')
}

test('asset backgrounds render through a fixed backdrop layer, not body inline styles', () => {
  const image = `asset:${'c'.repeat(64)}.jpg`
  const config = configWith({ globalBackground: { image, scrim: 0.4 } })
  const dispose = applyPersonalization(config)
  try {
    assert.equal(body.getAttribute('data-dsh-personal'), '')
    const layer = backdropLayer()
    assert.ok(layer !== null)
    assert.ok(layer.style.backgroundImage.includes(`/personalization/assets/${'c'.repeat(64)}.jpg`))
    // No body inline background: the layer owns the backdrop.
    assert.equal(body.style.backgroundImage, '')
    // The app root is transparented (background-only rule) so the layer shows.
    const style = injectedStyle()
    assert.ok(style !== null)
    assert.ok(style.textContent.includes('background:transparent'))
  } finally {
    dispose()
  }
  assert.equal(body.getAttribute('data-dsh-personal'), null)
  assert.equal(backdropLayer(), null)
  assert.equal(injectedStyle(), null)
})

test('data-url backgrounds render through blob URLs (createObjectURL present)', () => {
  const dataUrl = 'data:image/jpeg;base64,QUJDRA=='
  const config = configWith({ globalBackground: { image: dataUrl, scrim: 0.2 } })
  const dispose = applyPersonalization(config)
  try {
    // Node 24 provides URL.createObjectURL, so the engine converts the data URL
    // to a short blob: URL exactly like a browser would.
    const layer = backdropLayer()
    assert.ok(layer !== null && layer.style.backgroundImage.includes('blob:'), 'data URL converted to a blob URL')
  } finally {
    dispose()
  }
  assert.equal(backdropLayer(), null)
  assert.equal(body.style.backgroundImage, '')
})

test('asset favicons get the matching content type and host URL', () => {
  const image = `asset:${'d'.repeat(64)}.webp`
  const config = configWith({ chrome: { favicon: image, title: 'Custom title' } })
  const dispose = applyPersonalization(config)
  try {
    const link = head.querySelector<HTMLLinkElement>('link[rel="icon"]')
    assert.ok(link !== null)
    assert.equal(link.href, `http://localhost/personalization/assets/${'d'.repeat(64)}.webp`)
    assert.equal(link.type, 'image/webp')
    assert.equal(dom.window.document.title, 'Custom title')
  } finally {
    dispose()
  }
  assert.equal(head.querySelector('link[rel="icon"]'), null)
  assert.equal(dom.window.document.title, '')
})

test('panel background image resolves through asset URLs in the stylesheet', () => {
  const image = `asset:${'e'.repeat(64)}.png`
  const config = configWith({})
  config.panels.sidebar.background = { follow: false, mode: 'image', image, scrim: 0.3 }
  const dispose = applyPersonalization(config)
  try {
    const style = injectedStyle()
    assert.ok(style !== null)
    assert.ok(style.textContent.includes(`/personalization/assets/${'e'.repeat(64)}.png`))
  } finally {
    dispose()
  }
})

test('seeds derive the full contrast-preserving palette at the attribute scope', () => {
  const seeds = { accent: '#1a8a92', secondary: '#4fb3b8', surface: '#ffffff', text: '#16202b' }
  const config = configWith({})
  config.base.palette = { preset: '', accent: null, seeds, appearance: null }
  const dispose = applyPersonalization(config)
  try {
    const style = injectedStyle()
    assert.ok(style !== null)
    // The derived ramp overrides the stock steps under the personal scope...
    assert.ok(style.textContent.includes('html body[data-dsh-personal]{'))
    assert.ok(style.textContent.includes('--dsw-static-'))
    // ...for both schemes, selected by the app's scheme attribute.
    assert.ok(style.textContent.includes('html body[data-dsh-personal][data-ds-dark-theme]{'))
    // The page background pins on the surface seed verbatim.
    assert.ok(style.textContent.includes('--dsw-static-neutral-bluish-00:#ffffff'))
  } finally {
    dispose()
  }
})

test('a pinned seeds theme sets the scheme attribute and restores it on dispose', () => {
  const seeds = { accent: '#4dd0e1', secondary: '#e14d9c', surface: '#141419', text: '#ecebf0' }
  const config = configWith({})
  config.base.palette = { preset: '', accent: null, seeds, appearance: 'dark' }
  const dispose = applyPersonalization(config)
  try {
    assert.equal(body.hasAttribute('data-ds-dark-theme'), true)
    const style = injectedStyle()
    assert.ok(style !== null)
    // Only the pinned (dark) scheme block is emitted.
    assert.ok(style.textContent.includes(`html body[data-dsh-personal][data-ds-dark-theme]{`))
    assert.ok(!style.textContent.includes(`html body[data-dsh-personal]{--dsw-static`))
  } finally {
    dispose()
  }
  assert.equal(body.hasAttribute('data-ds-dark-theme'), false)
})

test('scrollbar and selection suffixes apply to EVERY scope selector', () => {
  // Regression: a pseudo-element suffix joined onto a comma-separated scope
  // list applies the declaration to the earlier bare selectors too — which
  // sized the sidebar/conversation elements to 10px and collapsed the frame
  // to a 14px blob ("all UI squished together").
  const config = configWith({})
  config.base.scrollbar = true
  config.base.selection = '#f2b0b8'
  config.base.palette.accent = '#e8a33d'
  const dispose = applyPersonalization(config)
  try {
    const style = injectedStyle()
    assert.ok(style !== null)
    // No bare pane selector may receive the scrollbar sizing or the selection
    // paint (every selector in the list must carry the pseudo).
    assert.ok(!style.textContent.includes('[data-pane="sidebar"]{width:10px'))
    assert.ok(!style.textContent.includes('[data-pane="conversation"]{width:10px'))
    assert.ok(!style.textContent.includes('[data-pane="sidebar"]{color:#fff'))
    // The pseudos themselves are targeted, for every selector in the list.
    assert.ok(style.textContent.includes('[data-pane="sidebar"]::-webkit-scrollbar,'))
    assert.ok(style.textContent.includes('[class*="sidebarCol"]::-webkit-scrollbar,'))
    assert.ok(style.textContent.includes('[data-pane="sidebar"]::selection,'))
    assert.ok(style.textContent.includes('[class*="sidebarCol"] ::selection{color:#202020'))
    // Regression: scroll containers nested INSIDE a panel (the task board and
    // SSH views scroll their own subtree, not the [data-…-view] element) must
    // receive the descendant pseudo form, or their scrollbars fall back to the
    // global skin color.
    assert.ok(style.textContent.includes('[data-pane="sidebar"] ::-webkit-scrollbar,'))
    assert.ok(style.textContent.includes('[class*="sidebarCol"] ::-webkit-scrollbar{width:10px'))
    assert.ok(style.textContent.includes('[data-dsh-taskboard-view] ::-webkit-scrollbar{width:10px'))
    assert.ok(style.textContent.includes('[data-dsh-ssh-view] ::-webkit-scrollbar{width:10px'))
    // Regression: the scrollbar thumb follows the theme accent instead of the
    // hardcoded neutral blue (light = accent, dark = accent lightened).
    assert.ok(style.textContent.includes('::-webkit-scrollbar-thumb{background:#e8a33d'))
    assert.ok(style.textContent.includes('::-webkit-scrollbar-thumb{background:color-mix(in srgb, #e8a33d 82%, #ffffff)'))
    // The layout-width variable mirrors the bar width (upstream aligns beside
    // --dsh-scrollbar-width, so a mismatch shifts the composer seat).
    assert.ok(style.textContent.includes('::-webkit-scrollbar{width:10px;height:10px;--dsh-scrollbar-width:10px'))
    // The selection text color flips by the selection's luminance: #f2b0b8 is
    // light, so dark text is chosen instead of a fixed white.
    assert.ok(style.textContent.includes('::selection{color:#202020;background:#f2b0b8'))
  } finally {
    dispose()
  }
})

test('glass surfaces derive from the theme surface seed, not the official base', () => {
  // Regression: the translucent alias backgrounds were hardcoded to the
  // official white/navy RGB, so a character theme's surface seed never tinted
  // the panels ("金色午后" rendered white instead of cream).
  const config = configWith({})
  config.base.palette = {
    preset: '',
    accent: null,
    seeds: { accent: '#e8a33d', secondary: '#d64550', surface: '#f7f0e3', text: '#3a2e22' },
    appearance: null,
  }
  const dispose = applyPersonalization(config)
  try {
    const style = injectedStyle()
    assert.ok(style !== null)
    // The alias background carries the surface tint (cream #f7f0e3) instead
    // of the hardcoded official white.
    assert.ok(style.textContent.includes('--dsw-alias-bg-base:rgba(247, 240, 227, '))
    assert.ok(!style.textContent.includes('--dsw-alias-bg-base:rgba(255, 255, 255, '))
  } finally {
    dispose()
  }
})

test('dispose removes the style tag, the layer, and the attribute', () => {
  const image = `asset:${'f'.repeat(64)}.png`
  const config = configWith({
    globalBackground: { image, scrim: 0.3 },
    base: { ...structuredClone(DEFAULT_CONFIG.base) as PersonalizationConfig['base'], palette: { preset: 'ocean', accent: null, seeds: null, appearance: null } },
  })
  const dispose = applyPersonalization(config)
  assert.ok(injectedStyle() !== null)
  assert.ok(backdropLayer() !== null)
  assert.ok(body.hasAttribute('data-dsh-personal'))
  dispose()
  assert.equal(injectedStyle(), null)
  assert.equal(backdropLayer(), null)
  assert.equal(body.hasAttribute('data-dsh-personal'), false)
  assert.equal(body.style.backgroundImage, '')
})
