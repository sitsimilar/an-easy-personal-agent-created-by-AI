import { useState } from 'react'
import { Box } from '@mui/material'
import type { InfoRecord } from '@shared/types/domain'
import { isHttpUrl } from '@/services/linkPreviewService'

interface LinkCoverProps {
  record: InfoRecord
  /** 高度/圆角等外观覆盖（默认 16:9 裁切）。 */
  sx?: Record<string, unknown>
}

/**
 * 链接封面（P0-C）。
 *
 * - 仅当封面 URL 为 http(s) 才渲染（避免 `javascript:` / `data:` 注入）；
 * - `objectFit: cover` + `aspectRatio: 16/9`，加载失败自动隐藏，不撑破卡片布局（C5）。
 */
export default function LinkCover({ record, sx }: LinkCoverProps) {
  const [broken, setBroken] = useState(false)
  const image = record.linkMeta?.image ?? null

  if (broken || !isHttpUrl(image)) return null

  return (
    <Box
      component="img"
      src={image as string}
      alt={record.linkMeta?.title ?? record.title ?? '链接封面'}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      sx={{
        width: '100%',
        aspectRatio: '16 / 9',
        objectFit: 'cover',
        display: 'block',
        bgcolor: 'action.hover',
        borderRadius: 1.5,
        ...(sx ?? {}),
      }}
    />
  )
}
