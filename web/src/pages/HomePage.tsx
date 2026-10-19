import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Grid,
  Pagination,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import type { InfoRecord } from '@shared/types/domain'
import { useRecordStore } from '@/store/recordStore'
import { recordService } from '@/services/recordService'
import RecordCard from '@/components/RecordCard'
import RecordDetail from '@/components/RecordDetail'
import RecordCreateDialog from '@/components/RecordCreateDialog'
import PageHeader from '@/components/PageHeader'

interface HomeStats {
  weekNew: number
  todoPending: number
  streak: number
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Grid item xs={6} sm={4}>
      <Card variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.5 }}>
          <Typography variant="h5" fontWeight={700}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {unit}
          </Typography>
        </Box>
      </Card>
    </Grid>
  )
}

/** 全部信息页（工作台）。 */
export default function HomePage() {
  const records = useRecordStore((s) => s.records)
  const total = useRecordStore((s) => s.total)
  const loading = useRecordStore((s) => s.loading)
  const error = useRecordStore((s) => s.error)
  const filter = useRecordStore((s) => s.filter)
  const load = useRecordStore((s) => s.load)
  const setFilter = useRecordStore((s) => s.setFilter)
  const resetFilter = useRecordStore((s) => s.resetFilter)
  const [detail, setDetail] = useState<InfoRecord | null>(null)
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const skipFirstLoad = useRef(true)

  // 进入「全部信息」页时清除残留筛选（type/category/keyword），确保展示全部信息（含最新记录）
  useEffect(() => {
    resetFilter()
  }, [resetFilter])

  useEffect(() => {
    // 挂载首帧跳过（filter 尚为旧值，resetFilter 会触发一次正确加载），避免双重请求
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false
      return
    }
    load()
  }, [load, filter])

  useEffect(() => {
    recordService
      .stats()
      .then(setStats)
      .catch(() => setStats(null))
  }, [])

  const pageSize = filter.pageSize ?? 20
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="全部信息" subtitle={`想法、资料、待办都在这里 · 共 ${total} 条`} />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatCard label="本周新增" value={stats?.weekNew ?? 0} unit="条" />
        <StatCard label="待办未完成" value={stats?.todoPending ?? 0} unit="条" />
        <StatCard label="连续记录" value={stats?.streak ?? 0} unit="天" />
      </Grid>

      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
        最近记录
      </Typography>

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
          <Typography sx={{ mb: 1.5 }}>暂无记录，从这里开始记录你的第一条信息</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            快速记录
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

      <RecordCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          load()
        }}
      />
    </Box>
  )
}
