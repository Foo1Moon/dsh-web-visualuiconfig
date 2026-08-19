/**
 * Deep merge for partial configuration patches — shared by both halves.
 *
 * The host half uses it for `PATCH /personalization/config`, the
 * `ctx.personalization` service, and the `/personalization` command; the
 * character-theme layer uses it to overlay a theme's appearance patch on the
 * live configuration (see src/shared/theme.ts). Environment-agnostic: no
 * `window`, no Node built-ins — both bundles inline this module.
 *
 * Semantics: plain objects merge recursively; `undefined` values are skipped
 * (leave the field untouched); `null` and every non-plain-object value
 * replace the current field. The config document contains no arrays, so
 * arrays are replaced wholesale.
 */

/** Whether a value is a plain (non-null, non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge `patch` into `base`, returning a new object (base is never mutated). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value)
      ? deepMerge(current, value)
      : value
  }
  return out as T
}
