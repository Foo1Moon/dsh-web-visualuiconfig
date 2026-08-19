/**
 * Shared config model tests: sanitize defaults/migration and asset ref
 * parsing/resolution (used by both the host and the browser halves).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG, assetUrl, parseAssetRef, resolveImageSource, sanitizeConfig,
} from '../../src/shared/config.ts'

test('sanitizeConfig defaults storageMode to host', () => {
  const config = sanitizeConfig({ enabled: true })
  assert.equal(config.storageMode, 'host')
  assert.equal(DEFAULT_CONFIG.storageMode, 'host')
})

test('sanitizeConfig preserves an explicit browser mode', () => {
  const config = sanitizeConfig({ storageMode: 'browser', enabled: true })
  assert.equal(config.storageMode, 'browser')
})

test('sanitizeConfig strips unknown fields and clamps values', () => {
  const config = sanitizeConfig({
    storageMode: 'host',
    enabled: 'yes',
    junk: 42,
    base: { glass: { opacity: 99 }, palette: { preset: 'ocean', accent: '#ff8800' } },
  })
  assert.equal(config.enabled, true)
  assert.equal('junk' in config, false)
  assert.equal(config.base.glass.opacity, 0.9)
  assert.equal(config.base.palette.preset, 'ocean')
})

test('sanitizeConfig clamps background fit and blur', () => {
  const config = sanitizeConfig({
    globalBackground: { image: 'data:image/jpeg;base64,xxx', scrim: 2, fit: 'zoom', blur: 999 },
    base: { background: { mode: 'image', image: 'data:image/jpeg;base64,yyy', scrim: 0.5, fit: 'tile' } },
    panels: { sidebar: { background: { follow: false, mode: 'image', image: 'data:image/jpeg;base64,zzz', scrim: 0.3, fit: 'stretch' } } },
  })
  // Unknown fit falls back to cover; blur clamps to the 60px cap; scrim 0..1.
  assert.equal(config.globalBackground.fit, 'cover')
  assert.equal(config.globalBackground.blur, 60)
  assert.equal(config.globalBackground.scrim, 1)
  assert.equal(config.base.background.fit, 'tile')
  assert.equal(config.panels.sidebar.background.fit, 'stretch')
})

test('sanitizeConfig trims chrome status text', () => {
  const config = sanitizeConfig({
    chrome: { statusText: 'x'.repeat(120), title: 'T', junk: 1 },
  })
  assert.equal(config.chrome.statusText.length, 64)
  assert.equal(config.chrome.statusText, 'x'.repeat(64))
  assert.equal(config.chrome.title, 'T')
})

test('sanitizeConfig migrates the legacy flat shape', () => {
  const config = sanitizeConfig({
    glass: { opacity: 0.3 },
    palette: { preset: 'ocean' },
    font: { family: 'rounded' },
    scrollbar: true,
    thirdParty: 'all',
  })
  assert.equal(config.base.glass.opacity, 0.3)
  assert.equal(config.base.palette.preset, 'ocean')
  assert.equal(config.base.scrollbar, true)
  // The legacy scope covered every third-party surface.
  assert.equal(config.panels.aionui.glass.follow, false)
})

test('parseAssetRef validates the asset id shape', () => {
  assert.deepEqual(parseAssetRef(`asset:${'a'.repeat(64)}.jpg`), { hash: 'a'.repeat(64), ext: 'jpg' })
  assert.equal(parseAssetRef(`asset:${'a'.repeat(63)}.jpg`), null)
  assert.equal(parseAssetRef(`asset:${'a'.repeat(64)}.exe`), null)
  assert.equal(parseAssetRef('data:image/jpeg;base64,xxx'), null)
})

test('assetUrl and resolveImageSource map asset refs to host URLs', () => {
  const id = `asset:${'b'.repeat(64)}.png`
  assert.equal(assetUrl(id), `/personalization/assets/${'b'.repeat(64)}.png`)
  assert.equal(resolveImageSource(id), `/personalization/assets/${'b'.repeat(64)}.png`)
  assert.equal(resolveImageSource(null), null)
  const dataUrl = 'data:image/jpeg;base64,AA=='
  assert.equal(resolveImageSource(dataUrl), dataUrl)
})
