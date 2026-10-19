import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import { authService } from './authService'

/** 允许上传的扩展名白名单（图片/PDF/常见文档；svg 可内嵌 script，已移除防 XSS）。 */
export const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'md', 'csv',
]

/** 单文件大小上限。 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 提取小写扩展名。 */
function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase()
}

/** 生成唯一对象 key（不信任客户端文件名，统一 uuid + 白名单扩展名）。 */
function buildObjectKey(userId: string, ext: string): string {
  const uuid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return cloud.storage.userPath(userId, `materials/${uuid}.${ext}`)
}

export const storageService = {
  /** 上传资料附件，返回云存储对象路径。 */
  async uploadMaterial(file: File): Promise<string> {
    const ext = extOf(file.name)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error('不支持的文件类型，仅支持图片、PDF 与常见文档')
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('文件大小不能超过 50MB')
    }

    const session = await authService.getSession()
    if (!session?.user?.id) throw new Error('请先登录')

    const path = buildObjectKey(session.user.id, ext)
    const result = await cloud.storage.upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    })
    unwrap(result)
    return path
  },

  /** 获取签名下载地址。 */
  async getSignedUrl(path: string): Promise<string> {
    const result = await cloud.storage.createSignedUrl(path, 600)
    const data = unwrap(result)
    return data.signedUrl
  },

  /** 删除附件对象。 */
  async remove(path: string): Promise<void> {
    const result = await cloud.storage.remove([path])
    unwrap(result)
  },
}
