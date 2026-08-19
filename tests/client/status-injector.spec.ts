/**
 * Status-text injector tests (jsdom): the official `Deep diving...` label is
 * replaced on `[role="status"]` text nodes, later mutations are covered by the
 * observer, unrelated live regions are never touched, and the disposer
 * restores the official text on the nodes it wrote.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installStatusInjector, OFFICIAL_STATUS_TEXT } from '../../src/client/status-injector.ts'

let dom: JSDOM
let body: HTMLElement

before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  })
  body = dom.window.document.body
})

after(() => {
  dom.window.close()
})

function statusEl(text: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.textContent = text
  body.appendChild(el)
  return el
}

test('replaces the official label and restores it on dispose', () => {
  const el = statusEl(OFFICIAL_STATUS_TEXT)
  const dispose = installStatusInjector('思考中...')
  try {
    assert.equal(el.textContent, '思考中...')
  } finally {
    dispose()
  }
  assert.equal(el.textContent, OFFICIAL_STATUS_TEXT)
})

test('observer covers elements mounted after install', async () => {
  const dispose = installStatusInjector('思考中...')
  try {
    const late = statusEl(OFFICIAL_STATUS_TEXT)
    // MutationObserver callbacks are async (microtask): give the observer a
    // beat, then the late element is rewritten too.
    await new Promise(r => setTimeout(r, 0))
    assert.equal(late.textContent, '思考中...')
  } finally {
    dispose()
  }
})

test('never touches unrelated live regions', () => {
  const dispose = installStatusInjector('思考中...')
  try {
    // A role=status element whose text is neither the official fallback nor an
    // injected value is left alone.
    const other = statusEl('uploading 3 files')
    assert.equal(other.textContent, 'uploading 3 files')
  } finally {
    dispose()
  }
})

test('an empty configured text installs nothing (no-op disposer)', () => {
  const el = statusEl(OFFICIAL_STATUS_TEXT)
  const dispose = installStatusInjector('')
  try {
    assert.equal(el.textContent, OFFICIAL_STATUS_TEXT)
  } finally {
    dispose()
  }
  assert.equal(el.textContent, OFFICIAL_STATUS_TEXT)
})
