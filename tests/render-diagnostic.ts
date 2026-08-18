/**
 * Temporary render diagnostic: boots the real engine inside jsdom with a
 * simulated frame (columns with the official class-name pattern), sets a
 * baseline backdrop image, and reports what the injected stylesheet and the
 * computed column styles actually contain.
 */
import { JSDOM } from 'jsdom'
import { applyPersonalization } from '../src/client/engine.ts'
import { DEFAULT_CONFIG } from '../src/client/settings.ts'

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div id="root">
    <div class="frame_sidebarCol" data-pane="sidebar">SIDEBAR</div>
    <div class="frame_centerCol" data-pane="conversation">CENTER</div>
    <div class="frame_detailsCol" data-pane="details">DETAILS</div>
  </div>
</body></html>`, { pretendToBeVisual: true })

const win = dom.window
Object.assign(globalThis, {
  window: win,
  document: win.document,
  HTMLElement: win.HTMLElement,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
})

// Simulate the real browser's URL.createObjectURL (jsdom/node lack it): the
// engine must render background images through short blob: URLs, never inline
// the base64 into the stylesheet (Chromium drops url() values > 2 MB).
let blobSeq = 0
const urlApi = URL as unknown as {
  createObjectURL: (blob: unknown) => string
  revokeObjectURL: (url: string) => void
}
urlApi.createObjectURL = () => `blob:mock-${blobSeq++}`
urlApi.revokeObjectURL = () => {}

const config = structuredClone(DEFAULT_CONFIG) as typeof DEFAULT_CONFIG & { base: { background: { mode: string; image: string; scrim: number } } }
// Simulate a baseline backdrop image; panels keep default follow = true.
config.base.background = { mode: 'image', image: 'data:image/jpeg;base64,/9j/4AAQAAAAAA==', scrim: 0.25 }

const dispose = applyPersonalization(config)

const style = win.document.querySelector('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]')
console.log('=== style tag ===')
console.log('exists:', style !== null, 'len:', style?.textContent?.length ?? 0)
console.log('text head:', style?.textContent?.slice(0, 400))

const sidebar = win.document.querySelector('[class*="sidebarCol"]')
console.log('=== sidebar computed ===')
console.log('bgImage:', win.getComputedStyle(sidebar).backgroundImage?.slice(0, 140))
console.log('bgColor:', win.getComputedStyle(sidebar).backgroundColor)
console.log('body attr:', win.document.body.getAttribute('data-dsh-personal'))
console.log('body scrim var:', win.document.body.style.getPropertyValue('--dsh-personal-scrim-sidebar'))

// --- assertions for the blob-URL fix ---
const css = style?.textContent ?? ''
const usesBlobUrl = css.includes('url(blob:mock-')
const leaksDataUri = css.includes('/9j/4AAQAAAAAA==')
const scrimHasFallback = css.includes('var(--dsh-personal-scrim-sidebar, 0)')
const ruleMatches = win.document.querySelectorAll('[class*="sidebarCol"]').length > 0
console.log('=== blob-URL assertions ===')
console.log('usesBlobUrl:', usesBlobUrl, '| leaksDataUri:', leaksDataUri, '| scrimHasFallback:', scrimHasFallback, '| ruleMatches:', ruleMatches)

dispose()
console.log('=== after dispose ===')
console.log('style gone:', win.document.querySelector('style[data-plugin-css="dsh-web-visualuiconfig/personal.css"]') === null)
console.log('body attr gone:', !win.document.body.hasAttribute('data-dsh-personal'))
