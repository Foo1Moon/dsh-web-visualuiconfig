/**
 * Character-theme extraction wizard: turn a picked character image into the
 * four palette seeds (+ scheme + tuned veil) that build a theme.
 *
 * The pipeline is deliberately short and all of it is local, following
 * deepseek-harness-skin's custom-skin channel: the picture is decoded once,
 * sampled small for colour (96px), and only the compressed bytes leave the
 * tab for the asset store. `analyzeImagePixels` is pure (plain RGBA in,
 * seeds out) so the whole analysis is unit-testable without a canvas; the
 * data-URL sampler below is the only DOM-dependent part.
 */
import { extractPalette, tuneCustomSkin } from '../shared/extract.ts'
import type { PaletteSeeds } from '../shared/config.ts'
import { STOCK } from '../shared/stock.generated.ts'

/** Width the image is sampled at for colour. Small on purpose: the histogram
 *  wants area, not detail, and downscaling averages neighbouring pixels. */
const SAMPLE_WIDTH = 96

/** What one image's colour analysis produced. */
export interface WizardAnalysis {
  /** The four seeds a theme derives its whole ramp from. */
  seeds: PaletteSeeds
  /** The scheme the image's brightness suggests. */
  appearance: 'light' | 'dark'
  /** The wash tuned until body text cleared its threshold (audit evidence). */
  veil: number
  /** Whether every readability contract cleared. */
  pass: boolean
}

/**
 * Analyse raw RGBA pixels into palette seeds + scheme + tuned veil.
 * Pure and environment-free — unit-tested without a canvas.
 * @param pixels - RGBA bytes of a downscaled copy of the image.
 * @returns the wizard analysis.
 */
export function analyzeImagePixels(pixels: Uint8ClampedArray): WizardAnalysis {
  const extracted = extractPalette(pixels)
  const tuned = tuneCustomSkin(extracted, STOCK)
  return {
    seeds: extracted.seeds,
    appearance: extracted.appearance,
    veil: tuned.theme.veil,
    pass: tuned.pass,
  }
}

/**
 * Sample a stored image (data URL) down to {@link SAMPLE_WIDTH} RGBA pixels.
 * @param dataUrl - the compressed image data URL.
 * @returns the RGBA buffer, or null when the image cannot be decoded or the
 * canvas is unavailable.
 */
export async function samplePixelsFromDataUrl(dataUrl: string): Promise<Uint8ClampedArray | null> {
  if (typeof document === 'undefined') return null
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = dataUrl
  })
  const scale = Math.min(1, SAMPLE_WIDTH / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}
