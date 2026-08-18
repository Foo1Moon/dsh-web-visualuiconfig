/**
 * Engine integration tests (jsdom): asset refs render as host URLs in the
 * live styles, data URLs keep the raw value in environments without
 * createObjectURL, and the disposer retracts every write.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { applyPersonalization } from '../../src/client/engine.ts'
import { DEFAULT_CONFIG, type PersonalizationConfig } from '../../src/shared/config.ts'

let dom: JSDOM
let body: HTMLElement

before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  })
  body = dom.window.document.body
})

after(() => {
  dom.window.close()
})

function configWith(patch: Partial<PersonalizationConfig>): PersonalizationConfig {
  const base = structuredClone(DEFAULT_CONFIG) as PersonalizationConfig
  return { ...base, ...patch }
}

test('asset backgrounds render through short host URLs', () => {
  const image = `asset:${'c'.repeat(64)}.jpg`
  const config = configWith({
    globalBackground: { image, scrim: 0.4 },
    base: { ...structuredClone(DEFAULT_CONFIG.base) as PersonalizationConfig['base'], background: { mode: 'image', image, scrim: 0.5 } },
  })
  const dispose = applyPersonalization(config)
  assert.equal(body.getAttribute('data-dsh-personal'), '')
  // jsdom serializes url() without quotes; assert the URL itself.
  assert.ok(body.style.backgroundImage.includes(`/personalization/assets/${'c'.repeat(64)}.jpg`))
  // The injected stylesheet exists and carries the panel backdrop rule.
  const style = dom.window.document.head.querySelector('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]')
  assert.ok(style !== null)
  dispose()
  assert.equal(body.getAttribute('data-dsh-personal'), null)
  assert.equal(body.style.backgroundImage, '')
  assert.equal(dom.window.document.head.querySelector('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]'), null)
})

test('data-url backgrounds render through blob URLs (createObjectURL present)', () => {
  const dataUrl = 'data:image/jpeg;base64,QUJDRA=='
  const config = configWith({ globalBackground: { image: dataUrl, scrim: 0.2 } })
  const dispose = applyPersonalization(config)
  // Node 24 provides URL.createObjectURL, so the engine converts the data URL
  // to a short blob: URL exactly like a browser would.
  assert.ok(body.style.backgroundImage.includes('blob:'), 'data URL converted to a blob URL')
  dispose()
  assert.equal(body.style.backgroundImage, '')
})

test('asset favicons get the matching content type and host URL', () => {
  const image = `asset:${'d'.repeat(64)}.webp`
  const config = configWith({ chrome: { favicon: image, title: 'Custom title' } })
  const dispose = applyPersonalization(config)
  const link = dom.window.document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
  assert.ok(link !== null)
  assert.equal(link.href, `http://localhost/personalization/assets/${'d'.repeat(64)}.webp`)
  assert.equal(link.type, 'image/webp')
  assert.equal(dom.window.document.title, 'Custom title')
  dispose()
  assert.equal(dom.window.document.head.querySelector('link[rel="icon"]'), null)
  assert.equal(dom.window.document.title, '')
})

test('panel background image resolves through asset URLs in the stylesheet', () => {
  const image = `asset:${'e'.repeat(64)}.png`
  const config = configWith({})
  config.panels.sidebar.background = { follow: false, mode: 'image', image, scrim: 0.3 }
  const dispose = applyPersonalization(config)
  const style = dom.window.document.head.querySelector<HTMLStyleElement>('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]')
  assert.ok(style !== null)
  assert.ok(style.textContent.includes(`/personalization/assets/${'e'.repeat(64)}.png`))
  dispose()
})
