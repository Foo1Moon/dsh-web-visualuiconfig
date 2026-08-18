/**
 * Client-side image compression: decode a picked file and re-encode it as a
 * downscaled JPEG data URL, so the background/favicon fits comfortably in
 * localStorage (the same JPEG-encoding route the dsh-web-ui skins use for
 * their inlined art, done in the browser instead of Python).
 *
 * `aspect` (width / height) center-crops the source to that ratio first —
 * used for per-panel backdrops, which are sized to the panel's own shape.
 */

/** Decode a file into an HTMLImageElement. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`image decode failed: ${file.name}`))
    }
    img.src = url
  })
}

/** Compression options for a picked image. */
export interface CompressOptions {
  /** Longest-edge cap in px after any crop (default 1920). */
  maxWidth?: number
  /** JPEG quality 0..1 (default 0.8). */
  quality?: number
  /** Target width/height ratio; center-crops the source to it when given. */
  aspect?: number
}

/**
 * Compress an image file to a downscaled JPEG data URL.
 * @param file - the picked image file.
 * @param options - compression and crop options.
 * @returns the data URL, or null when the file cannot be decoded.
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<string | null> {
  const maxWidth = options.maxWidth ?? 1920
  const quality = options.quality ?? 0.8
  const img = await loadImage(file)

  // Center-crop to the target ratio when requested.
  let sourceW = img.naturalWidth
  let sourceH = img.naturalHeight
  let sourceX = 0
  let sourceY = 0
  if (options.aspect !== undefined && options.aspect > 0) {
    const sourceAspect = sourceW / sourceH
    if (sourceAspect > options.aspect) {
      sourceW = Math.round(sourceH * options.aspect)
      sourceX = Math.round((img.naturalWidth - sourceW) / 2)
    } else {
      sourceH = Math.round(sourceW / options.aspect)
      sourceY = Math.round((img.naturalHeight - sourceH) / 2)
    }
  }

  const scale = Math.min(1, maxWidth / Math.max(sourceW, sourceH))
  const width = Math.max(1, Math.round(sourceW * scale))
  const height = Math.max(1, Math.round(sourceH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  // JPEG has no alpha channel: paint an opaque white backdrop first.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}
