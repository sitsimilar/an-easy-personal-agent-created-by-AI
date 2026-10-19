/**
 * 缩略图生成（浏览器 Canvas）：保持宽高比、最长边缩放到目标尺寸、不放大。
 * 尺寸计算为纯函数（可单测）；Canvas 生成依赖浏览器环境。
 */

/** 计算缩略图尺寸：最长边 = target，保持比例，且不放大（原图更小则保留原尺寸）。 */
export function computeThumbnailSize(
  srcW: number,
  srcH: number,
  target: number,
): { w: number; h: number } {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { w: target, h: target }
  }
  const scale = Math.min(target / srcW, target / srcH, 1)
  return {
    w: Math.max(1, Math.round(srcW * scale)),
    h: Math.max(1, Math.round(srcH * scale)),
  }
}

/** 用 Canvas 生成缩略图（保持原格式，PNG 保留透明；透明通道需画布未污染）。 */
export async function generateThumbnail(file: File, target: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const { w, h } = computeThumbnailSize(bitmap.width, bitmap.height, target)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const type = file.type && file.type.startsWith('image/') ? file.type : 'image/png'
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成缩略图失败'))), type, 0.9)
    })
  } finally {
    bitmap.close()
  }
}
