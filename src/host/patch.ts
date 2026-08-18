/**
 * Deep merge for partial configuration patches (the `PATCH` route, the
 * `ctx.personalization` service, and the `/personalization` command all accept
 * partial updates and merge them into the current document).
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
