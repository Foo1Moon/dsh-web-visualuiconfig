/**
 * Deep merge for partial configuration patches — now lives in the shared
 * layer (src/shared/patch.ts) so the browser half can overlay character-theme
 * patches too. This module re-exports it to keep the historical import path
 * (`./patch.ts`) intact for the host half and its tests.
 */
export { deepMerge } from '../shared/patch.ts'
