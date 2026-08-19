/**
 * Shape of upstream's parsed palette, as `scripts/build-stock.mjs` emits it
 * into `src/shared/stock.generated.ts`.
 *
 * The parse itself stays in the build script — it reads `design-platform.css`
 * off disk, which the browser cannot do. What both sides need is the *result*,
 * so the result is a generated data module: the Node generator, the Host boot
 * transform and the browser's character-theme derivation all read the same
 * numbers, and a change to upstream's palette reaches all three through one
 * regenerate.
 *
 * Ported from deepseek-harness-skin (MIT, © 2026 HeiGeAi / Blake Xu —
 * https://github.com/HeiGeAi/deepseek-harness-skin), file
 * `packages/client/ui-theme/src/skins/stock.ts`, with no semantic changes.
 */

/** One stock palette step, pre-converted to OKLCh. */
export interface StockStep {
  /** The `--dsw-static-*` custom property name. */
  name: string
  /** Lightness, 0..1. */
  L: number
  /** Chroma. */
  C: number
  /** Hue in degrees. */
  h: number
}

/** Upstream's palette and semantic layer, everything derivation needs. */
export interface StockData {
  /**
   * Steps grouped by family name (`--dsw-static-neutral-bluish`, …), sorted
   * lightest first.
   */
  families: Record<string, StockStep[]>
  /** Every step's raw hex, keyed by custom property name. */
  hex: Record<string, string>
  /**
   * The semantic layer per scheme: token name → raw declaration, mostly
   * `var(--dsw-static-*)` references.
   */
  aliases: { light: Record<string, string>; dark: Record<string, string> }
}
