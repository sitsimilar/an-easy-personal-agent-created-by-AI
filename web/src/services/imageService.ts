/**
 * 图片存储服务：上传（原图 + 128/256/512 三档缩略图）、列表、签名 URL、删除。
 *
 * - 文件 ≤10MB、仅 JPEG/PNG/WebP；
 * - 文件名 1–20 字符、中英文数字下划线，允许重名（不建唯一约束）；
 * - 主键 id 为 BIGINT 自增，展示时零填充为 9 位数字。
 */
import { cloud } from '@/lib/cloud'
import { unwrap } from '@/lib/unwrap'
import type { ImagesRow } from '@/lib/database.types'
import { authService } from './authService'
import { generateThumbnail } from '@/lib/thumbnail'

/** 允许的图片扩展名。 */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

/** 单张图片大小上限（10MB）。 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024

/** 缩略图三档尺寸。 */
export const THUMB_SIZES = [128, 256, 512] as const

/** 文件名校验：1–20 字符，仅中英文、数字、下划线。返回错误文案（null 表示合法）。 */
export function validateImageName(name: string): string | null {
  const n = name.trim()
  if (!n) return '文件名不能为空'
  if (Array.from(n).length > 20) return '文件名不能超过 20 个字符'
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(n)) return '文件名仅支持中英文、数字和下划线'
  return null
}

/** 展示用 ID：BIGINT 零填充为 9 位数字。 */
export function formatImageId(id: number): string {
  return String(id).padStart(9, '0')
}

function extOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  const ext = idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

function buildKey(ownerId: string, id: number, suffix: string, ext: string): string {
  return cloud.storage.userPath(ownerId, `images/${formatImageId(id)}/${suffix}.${ext}`)
}

/** 上传单张图片：先写库占位获得自增 id，再上传原图 + 三档缩略图，最后回填路径。 */
export const imageService = {
  async uploadImage(file: File, name: string): Promise<ImagesRow> {
    const nameErr = validateImageName(name)
    if (nameErr) throw new Error(nameErr)
    const ext = extOf(file.name)
    if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error('仅支持 JPEG/PNG/WebP 格式')
    if (file.size > MAX_IMAGE_SIZE) throw new Error('图片大小不能超过 10MB')

    const session = await authService.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) throw new Error('请先登录')

    // 1. 写库占位（owner_id 由后端 DEFAULT auth.uid() 填充），获得自增 id
    const ins = unwrap(
      await cloud.database.from('images').insert({
        name: name.trim(),
        mime_type: file.type || 'image/jpeg',
        size: file.size,
      }).select(),
    ) as ImagesRow[] | null
    if (!ins || ins.length === 0) throw new Error('创建图片记录失败')
    const id = ins[0].id

    const uploadedPaths: string[] = []
    try {
      // 2. 生成三档缩略图 + 上传原图与缩略图
      const thumbs = await Promise.all(THUMB_SIZES.map((s) => generateThumbnail(file, s)))
      const paths = {
        original: buildKey(ownerId, id, 'original', ext),
        t128: buildKey(ownerId, id, 'thumb_128', ext),
        t256: buildKey(ownerId, id, 'thumb_256', ext),
        t512: buildKey(ownerId, id, 'thumb_512', ext),
      }
      unwrap(await cloud.storage.upload(paths.original, file, { contentType: file.type || 'application/octet-stream' }))
      uploadedPaths.push(paths.original)
      for (let i = 0; i < thumbs.length; i++) {
        const p = [paths.t128, paths.t256, paths.t512][i]
        unwrap(await cloud.storage.upload(p, thumbs[i], { contentType: thumbs[i].type || 'image/jpeg' }))
        uploadedPaths.push(p)
      }

      // 3. 回填路径
      const upd = unwrap(
        await cloud.database.from('images').update({
          original_path: paths.original,
          thumb_128_path: paths.t128,
          thumb_256_path: paths.t256,
          thumb_512_path: paths.t512,
        }).eq('id', id).select(),
      ) as ImagesRow[] | null
      return upd?.[0] ?? { ...ins[0], original_path: paths.original, thumb_128_path: paths.t128, thumb_256_path: paths.t256, thumb_512_path: paths.t512 }
    } catch (err) {
      // 失败回滚：删除占位记录 + 反向清理已成功上传的对象（避免孤儿对象）
      try {
        await cloud.database.from('images').delete().eq('id', id).select()
      } catch {
        /* 忽略回滚失败 */
      }
      if (uploadedPaths.length > 0) {
        try {
          await cloud.storage.remove(uploadedPaths)
        } catch {
          /* 对象清理失败不阻断主流程 */
        }
      }
      throw err
    }
  },

  /** 列表（按创建时间倒序）。 */
  async listImages(limit = 50): Promise<ImagesRow[]> {
    const rows = unwrap(
      await cloud.database.from('images').select('*').order('created_at', { ascending: false }).limit(limit),
    ) as ImagesRow[] | null
    return rows ?? []
  },

  /** 单条。 */
  async getImage(id: number): Promise<ImagesRow | null> {
    const row = unwrap(await cloud.database.from('images').select('*').eq('id', id).maybeSingle()) as ImagesRow | null
    return row
  },

  /** 获取各档签名 URL（原图 + 三档缩略图）。 */
  async getSignedUrls(row: ImagesRow): Promise<{ original: string | null; t128: string | null; t256: string | null; t512: string | null }> {
    const sign = async (p: string | null) => (p ? (unwrap(await cloud.storage.createSignedUrl(p, 600)) as { signedUrl: string }).signedUrl : null)
    return {
      original: await sign(row.original_path),
      t128: await sign(row.thumb_128_path),
      t256: await sign(row.thumb_256_path),
      t512: await sign(row.thumb_512_path),
    }
  },

  /** 删除：先删库记录、后删对象（对象删除失败仅告警，不阻断，避免留死图记录）。 */
  async deleteImage(id: number): Promise<void> {
    const row = await imageService.getImage(id)
    // 先删库：即使对象删除失败，也不会留下指向已删除对象的脏记录
    unwrap(await cloud.database.from('images').delete().eq('id', id).select())
    if (row) {
      const keys = [row.original_path, row.thumb_128_path, row.thumb_256_path, row.thumb_512_path].filter((p): p is string => !!p)
      if (keys.length > 0) {
        try {
          await cloud.storage.remove(keys)
        } catch {
          /* 对象删除失败不阻断（记录已删） */
        }
      }
    }
  },
}
