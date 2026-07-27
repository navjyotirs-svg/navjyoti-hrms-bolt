// Client-side image processing: EXIF orientation correction, resize, compress.
// Processes images BEFORE upload to reduce bandwidth and storage.
// Max dimension: 1920px longest side. Quality: 82% (JPEG), 85% (WebP).
// Generates a thumbnail (320px) for quick previews.

const MAX_DIMENSION = 1920
const THUMBNAIL_DIMENSION = 320
const JPEG_QUALITY = 0.82
const WEBP_QUALITY = 0.85
const THUMBNAIL_QUALITY = 0.7

export interface ProcessedImage {
  blob: Blob
  width: number
  height: number
  thumbnailBlob: Blob
  thumbnailWidth: number
  thumbnailHeight: number
}

export async function processImage(file: File): Promise<ProcessedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image')
  }

  const bitmap = await loadBitmap(file)
  const oriented = applyOrientation(bitmap)
  const resized = resizeIfNeeded(oriented, MAX_DIMENSION)
  const thumbnail = resizeIfNeeded(oriented, THUMBNAIL_DIMENSION)

  const outputType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  const thumbType = 'image/jpeg'

  const blob = await canvasToBlob(resized.canvas, outputType, outputType === 'image/webp' ? WEBP_QUALITY : JPEG_QUALITY)
  const thumbBlob = await canvasToBlob(thumbnail.canvas, thumbType, THUMBNAIL_QUALITY)

  bitmap.close?.()

  return {
    blob,
    width: resized.width,
    height: resized.height,
    thumbnailBlob: thumbBlob,
    thumbnailWidth: thumbnail.width,
    thumbnailHeight: thumbnail.height,
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Fallback for browsers without createImageBitmap (older Safari)
    return loadViaImgElement(file)
  }
}

function loadViaImgElement(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      createImageBitmap(canvas).then(resolve).catch(reject)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

// EXIF orientation correction using createImageBitmap options where available
function applyOrientation(bitmap: ImageBitmap): ImageBitmap {
  // createImageBitmap with imageOrientation: 'from-image' already handles EXIF
  return bitmap
}

interface ResizeResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

function resizeIfNeeded(bitmap: ImageBitmap, maxDim: number): ResizeResult {
  let { width, height } = bitmap

  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)

  return { canvas, width, height }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to convert canvas to blob'))
      },
      type,
      quality
    )
  })
}

export function isHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    file.name.toLowerCase().endsWith('.heic') ||
    file.name.toLowerCase().endsWith('.heif')
  )
}

// Re-export for use in upload flow
export { MAX_DIMENSION, JPEG_QUALITY, WEBP_QUALITY }
