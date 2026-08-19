/**
 * Running-turn status text injector. Official ui-conversation hard-codes
 * `Deep diving...` in the chat view's TurnStatus with no provider seam, so
 * this plugin replaces that rendered text directly: a MutationObserver
 * rewrites the `[role="status"]` element's text node whenever it shows the
 * official fallback (or a node this injector wrote). The disposer restores the
 * official fallback on the nodes it touched, so clearing the field leaves no
 * stale custom text behind.
 *
 * Only text nodes are touched, and only when they currently hold the official
 * fallback or an injected value — other live regions (any other
 * `role="status"` element) are never modified.
 */

/** The official hard-coded status text this injector replaces. */
export const OFFICIAL_STATUS_TEXT = 'Deep diving...'

/** Selector for the running-turn status element (official markup: `role="status" aria-live="polite"`). */
const STATUS_SELECTOR = '[role="status"]'

/**
 * Install the status-text injector.
 * @param text - the user-configured status text (non-empty).
 * @returns a disposer removing the observer and restoring the official text.
 */
export function installStatusInjector(text: string): () => void {
  if (typeof document === 'undefined' || text.trim() === '') return () => {}
  // Text nodes this injector wrote; the disposer restores exactly these.
  const injected = new WeakSet<Text>()
  const replace = (): void => {
    for (const element of document.querySelectorAll<HTMLElement>(STATUS_SELECTOR)) {
      for (const node of element.childNodes) {
        // TEXT_NODE (3): no global `Text` dependency (jsdom/Node both fine).
        if (node.nodeType !== 3) continue
        if (node.nodeValue === text) continue
        if (node.nodeValue === OFFICIAL_STATUS_TEXT || injected.has(node as Text)) {
          node.nodeValue = text
          injected.add(node as Text)
        }
      }
    }
  }
  replace()
  const observer = new MutationObserver(replace)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const element of document.querySelectorAll<HTMLElement>(STATUS_SELECTOR)) {
      for (const node of element.childNodes) {
        if (node.nodeType === 3 && injected.has(node as Text)) {
          node.nodeValue = OFFICIAL_STATUS_TEXT
        }
      }
    }
  }
}
