/**
 * A derived skin, formatted as CSS.
 *
 * Shared for the same reason the derivation is: the stock generator writes the
 * built-in theme rules at build time, and a character theme has to produce
 * byte-comparable rules at runtime — once in the browser when the user applies
 * it. Two formatters would be two chances for a theme to paint something
 * another never would.
 *
 * The only thing that differs between callers is how a hero filename becomes a
 * URL: the generator emits a bundler-resolved relative path, the runtime emits
 * the Host route that serves stored character art.
 *
 * Ported from deepseek-harness-skin (MIT, © 2026 HeiGeAi / Blake Xu —
 * https://github.com/HeiGeAi/deepseek-harness-skin), file
 * `packages/client/ui-theme/src/skins/render.ts`, with no semantic changes.
 */

import type { DerivedSkin, SkinTheme } from './derive.ts'

/**
 * Format one skin's rules.
 *
 * Two blocks come out. The first carries the `--skin-*` chrome inputs and is
 * also published to a `[data-skin-preview]` scope, so the picker can paint an
 * accurate swatch from a plain element without activating the skin. The second
 * carries the palette and brand overrides and is scoped to the active body,
 * because those tokens are what the whole app reads.
 *
 * @param theme - the theme definition.
 * @param derived - what {@link import('./derive.ts').deriveSkin} produced for it.
 * @param heroUrl - turns the theme's `hero` filename into a CSS `url()` value.
 * @returns the CSS text, newline-terminated.
 */
export function renderSkinCss(
  theme: SkinTheme, derived: DerivedSkin, heroUrl: (hero: string) => string,
): string {
  const scope = `body[data-dsh-skin='${theme.id}']`
  const lines: string[] = []

  lines.push(`/* seeds: accent ${theme.seeds.accent} · secondary ${theme.seeds.secondary}`)
  lines.push(` * surface ${theme.seeds.surface} · text ${theme.seeds.text} · ${theme.appearance} */`)
  lines.push(`${scope},`)
  lines.push(`[data-skin-preview='${theme.id}'] {`)
  for (const name of Object.keys(derived.chrome)) lines.push(`  ${name}: ${derived.chrome[name]};`)
  if (theme.hero !== undefined) {
    lines.push(`  --skin-hero: ${heroUrl(theme.hero)};`)
    lines.push(`  --skin-hero-focus: ${theme.heroFocus ?? '50% 50%'};`)
  }
  if (theme.glyph !== undefined) lines.push(`  --skin-glyph: '${theme.glyph}';`)
  // The badge's digits live in the frame, so a skin only reveals or hides it.
  if (theme.showBadge === true) lines.push('  --skin-badge: inline-block;')
  lines.push('}')
  lines.push('')

  lines.push(`${scope} {`)
  if (theme.font !== undefined) lines.push(`  --dsw-font-family: ${theme.font};`)
  lines.push('  /* brand roles: stock points these at near-black, not at an accent */')
  for (const name of Object.keys(derived.brand).sort()) lines.push(`  ${name}: ${derived.brand[name]};`)
  lines.push('')
  lines.push('  /* palette: upstream contrast structure, skin hue and chroma */')
  for (const name of Object.keys(derived.palette).sort()) lines.push(`  ${name}: ${derived.palette[name]};`)
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}
