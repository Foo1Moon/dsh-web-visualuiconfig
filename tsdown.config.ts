/**
 * Self-contained tsdown preset for a standalone dsh client plugin.
 *
 * Emits two artifacts into lib/:
 * - lib/index.js  — the (minimal) host half, plain ESM for the cordis Loader.
 * - lib/client.js — the browser half: a closure-factory bundle that calls
 *   window.__ModuleLoader__.load({ id, factory }) and resolves platform
 *   externals through the injected require (the loader module table).
 *
 * CSS Modules are compiled by lightningcss inside the bundle: importing
 * `x.module.css` yields the hashed class map, and the css text auto-injects a
 * <style data-plugin="<id>"> tag at factory execution (the loader removes
 * plugin-owned tags on unload). The virtual loader registers each real
 * stylesheet as a watch dependency.
 *
 * This is a standalone copy of the shared preset that lives inside the
 * deepseek-harness checkout (packages/client/tsdown.client.ts), adapted to a
 * package that cannot import from that repository.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The plugin id stamped into the __ModuleLoader__.load handoff. */
const PLUGIN_ID = 'dsh-web-visualuiconfig'

/**
 * The browser platform modules the shell shares into the frozen module table.
 * Kept in sync with packages/client/web/src/platform.ts in deepseek-harness:
 * these specifiers are external (answered by the loader require), everything
 * else is inlined.
 */
const PLATFORM_MODULES: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Externals resolved from the loader module table (platform seed entries). */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Host-half library config: plain ESM for the node side. */
const hostConfig: UserConfig = {
  name: PLUGIN_ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  clean: false,
  outputOptions: {
    entryFileNames: 'index.js',
  },
}

/** Browser-half bundle config: closure-factory CJS for the module loader. */
const clientConfig: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // The loader module table answers these specifiers at runtime.
    neverBundle: [...CLIENT_EXTERNALS],
    // Everything else (clsx, zod — every non-shared dep) inlines.
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  // Browser bundles inline node-idiom deps; define substitutes the probes
  // they make (zustand/immer read process.env.NODE_ENV, and zustand's esm
  // build probes import.meta.env.MODE, which a CJS output cannot carry).
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // tsdown auto-externalizes package dependencies; the `deps` block above
  // pins the loader-table externals and inlines everything else.
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis '
        + 'services (type-only imports are erased and never reach this gate)',
      )
    },
  }, {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      // One <style data-plugin> per module file; idempotent under re-evaluation.
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

export default [hostConfig, clientConfig]
