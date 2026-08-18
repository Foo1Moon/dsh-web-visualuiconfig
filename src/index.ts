/**
 * Host half of the personalization plugin: the machine-level persistence
 * layer behind the browser-side styling surface.
 *
 * The browser half still does all the styling work, but its configuration now
 * lives (by default) in `~/.dsh/dsh-web-personalization.json`, served back to
 * any browser through the `/personalization/*` routes registered here. This
 * half mounts the config store, the image asset store, and the HTTP router;
 * it also provides the `ctx.personalization` service for other plugins, and
 * registers the `/personalization` command and the `personalization` agent
 * tool (both lazily, via ctx.inject, so the plugin applies even where those
 * services are absent). On dispose it only tears down runtime state (routes,
 * SSE, service) — never the user's files, which are removed only through the
 * explicit `/personalization/uninstall` route (see docs/host-design.md §8).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer/commands/personalization/tools Context merges
// (runtime services are provided by the composition; this package declares
// only the members it uses).
import type {} from './host/types.ts'
import { AssetStore } from './host/assets.ts'
import { registerPersonalizationCommand } from './host/commands.ts'
import { createPersonalizationRouter } from './host/routes.ts'
import { PersonalizationStore } from './host/store.ts'
import { registerPersonalizationTool } from './host/tool.ts'

/** Required services: the web HTTP carrier (route registration). */
export const inject = ['webServer']

/**
 * Mount the host persistence surface.
 * @param ctx - host plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const store = new PersonalizationStore()
  const assets = new AssetStore(store.assetsDir)
  const router = createPersonalizationRouter(store, assets)

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: '/personalization',
      handler: router.handle,
    })
    return () => {
      disposeRoute()
      router.dispose()
    }
  }, 'personalization: host routes')

  // The programmatic service: other plugins inject ['personalization'] to
  // read/update/reset the machine config and observe revisions. Plain object
  // (the web-app bundle provides services the same way); it is torn down with
  // this plugin's fiber.
  ctx.provide('personalization', {
    read: () => store.getSnapshot(),
    update: (patch) => store.patch(patch),
    reset: () => store.reset(),
    onUpdated: (listener) => store.subscribe(listener),
  })

  // The human-facing command, registered only when the commands service is
  // present (base bundle) — never blocks this plugin's apply.
  ctx.inject(['commands'], (commandsCtx) => {
    const disposeCommand = registerPersonalizationCommand(commandsCtx.commands, store, assets)
    ctx.effect(() => () => disposeCommand(), 'personalization: /personalization command')
  })

  // The model-facing tool: lets the agent change the appearance from natural
  // language. Registered only when the tools + systemPrompt services are
  // present (base bundle) — never blocks this plugin's apply.
  ctx.inject(['tools', 'systemPrompt'], (toolsCtx) => {
    const disposeTool = registerPersonalizationTool(toolsCtx.tools, toolsCtx.systemPrompt, store, assets)
    ctx.effect(() => () => disposeTool(), 'personalization: personalization tool')
  })
}
