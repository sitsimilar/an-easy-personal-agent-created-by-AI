import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Box, Button, Chip, CircularProgress, Grid, Pagination, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import type { InfoRecord, RecordType } from '@shared/types/domain'
import { useRecordStore } from '@/store/recordStore'
import RecordCard from '@/components/RecordCard'
import RecordDetail from '@/components/RecordDetail'
import PageHeader from '@/components/PageHeader'

const TYPE_LABEL: Record<RecordType, string> = {
  idea: '想法',
  material: '资料',
  todo: '待办',
}

interface RecordsPageProps {
  /** 记录类型筛选（props 优先于 URL searchParams，供整合版悬浮窗内嵌使用）。 */
  type?: RecordType
  /** 分类标签筛选（props 优先）。 */
  category?: string
  /** 关键词筛选（props 优先）。 */
  keyword?: string
}

/** 想法 / 资料 / 分类标签视图。 */
const RECORD_TYPES: readonly string[] = ['idea', 'material', 'todo']

export default function RecordsPage(props: RecordsPageProps) {
  const [params, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const rawType = props.type ?? params.get('type') ?? undefined
  const type = rawType && RECORD_TYPES.includes(rawType) ? (rawType as RecordType) : undefined
  const category = props.category ?? params.get('category') ?? undefined
  const keyword = props.keyword ?? params.get('keyword') ?? undefined

  const records = useRecordStore((s) => s.records)
  const total = useRecordStore((s) => s.total)
  const loading = useRecordStore((s) => s.loading)
  const error = useRecordStore((s) => s.error)
  const filter = useRecordStore((s) => s.filter)
  const load = useRecordStore((s) => s.load)
  const setFilter = useRecordStore((s) => s.setFilter)
  const [detail, setDetail] = useState<InfoRecord | null>(null)
  const skipFirstLoad = useRef(true)

  useEffect(() => {
    setFilter({ type, category, keyword, isDeleted: false, page: 1 })
  }, [type, category, keyword, setFilter])

  useEffect(() => {
    // 挂载首帧跳过（此时 filter 还是旧值，随后 setFilter 会触发一次正确加载），避免双重请求
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false
      return
    }
    load()
  }, [load, filter])

  const pageSize = filter.pageSize ?? 20
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const title = keyword
    ? `搜索「${keyword}」`
    : category
      ? category
      : type
        ? TYPE_LABEL[type]
        : '全部信息'

  const subtitle = keyword
    ? `搜索「${keyword}」的结果`
    : category
      ? '该分类标签下的记录'
      : type === 'idea'
        ? '随手记下的灵感与待验证的判断'
        : type === 'material'
          ? '收藏的文档、链接与代码片段'
          : '想法、资料、待办都在这里'

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title={title}
        subtitle={`${subtitle} · 共 ${total} 条`}
        action={
          keyword ? (
            <Chip
              size="small"
              label="清除搜索"
              onDelete={() => {
                const next = new URLSearchParams(params)
                next.delete('keyword')
                setSearchParams(next, { replace: true })
              }}
            />
          ) : undefined
        }
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 8 }}>
          <Typography color="error">{error}</Typography>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>
            重试加载
          </Button>
        </Box>
      ) : records.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
          <Typography sx={{ mb: 1.5 }}>没有符合条件的记录</Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => navigate('/')}>
            去全部信息记录
          </Button>
        </Box>
      ) : (
        <>
          <Grid container spacing={2}>
            {records.map((r) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={r.id}>
                <RecordCard record={r} onClick={() => setDetail(r)} />
              </Grid>
            ))}
          </Grid>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination
              count={pageCount}
              page={filter.page ?? 1}
              onChange={(_e, page) => setFilter({ page })}
              color="primary"
            />
          </Box>
        </>
      )}

      <RecordDetail
        record={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onChanged={load}
        onDeleted={load}
        onOpenRecord={setDetail}
      />
    </Box>
  )
}
