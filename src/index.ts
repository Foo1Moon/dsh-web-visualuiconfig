/**
 * Host half of the personalization plugin.
 *
 * The whole personalization surface is browser-side: it styles the live page
 * directly and persists its configuration in localStorage. This host half
 * exists only because a cordis plugin row needs a node-side entry — it mounts
 * nothing and owns no host state.
 */

/**
 * Required services: none.
 */
export const inject: string[] = []

/**
 * No-op host registration.
 */
export function apply(): void {
  // The browser half (src/client) does all the work.
}
